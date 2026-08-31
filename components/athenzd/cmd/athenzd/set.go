package main

import (
	"fmt"
	"io"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/jwt"
	"github.com/AthenZ/athenzd/internal/zms"
	"github.com/spf13/cobra"
)

type scopeSelector func(io.Reader, io.Writer, []string) (string, error)

func newSetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set",
		Short: "Change active athenzd settings",
	}
	cmd.AddCommand(newSetGenAIProjectCmd())
	return cmd
}

func newSetGenAIProjectCmd() *cobra.Command {
	return newSetGenAIProjectCmdWithSelectors(promptDefaultProject, promptGenAIScope)
}

func newSetGenAIProjectCmdWithSelectors(selectProject projectSelector, selectScope scopeSelector) *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "genai-project",
		Short: "Refresh eligible GenAI roles and select the active access-token scope",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved, err := config.Resolve(file)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "config: %s (%s)\n", resolved.Path, resolved.Source)

			cfg, err := config.LoadResolved(resolved)
			if err != nil {
				return err
			}
			if cfg.GenAI.Domain == "" || cfg.GenAI.Role == "" {
				return fmt.Errorf("gen_ai.domain and gen_ai.role must be configured; run `athenzd login` after configuring them")
			}
			if cfg.Athenz.ZMS == "" {
				return fmt.Errorf("athenz.zms is required to refresh eligible GenAI roles")
			}
			svcName := cfg.CurrentService
			if svcName == "" {
				return fmt.Errorf("current_service is not set in config")
			}
			svc, err := findService(cfg, svcName)
			if err != nil {
				return err
			}

			entry, err := cache.Load(svcName)
			if err != nil {
				return fmt.Errorf("no cached token for %q — run `athenzd login` first: %w", svcName, err)
			}
			if entry.IsExpired() {
				return fmt.Errorf("cached ID token for %q is expired — run `athenzd login` again", svcName)
			}
			claims, err := jwt.Decode(entry.IDToken)
			if err != nil {
				return fmt.Errorf("decoding cached ID token: %w", err)
			}
			target, err := zms.ResolveTarget(svc.Athenz.Service, claims.PreferredUsername)
			if err != nil {
				return fmt.Errorf("deriving Athenz service from cached ID token: %w", err)
			}

			fmt.Fprintln(cmd.OutOrStdout(), "Refreshing eligible GenAI project roles from Athenz...")
			freshScopes := make(map[string][]string)
			idJAGs, err := issueIDJAGs(cmd.Context(), cfg, svc, entry.IDToken, target, func(projects []genai.ServiceScopes) {
				for _, project := range projects {
					freshScopes[project.Service] = append([]string(nil), project.Scopes...)
				}
				for _, line := range formatEligibleRoles(target.UserPrincipal, projects) {
					fmt.Fprintln(cmd.OutOrStdout(), line)
				}
			})
			if err != nil {
				return err
			}
			for _, issued := range sortedIDJAGs(idJAGs) {
				fmt.Fprintf(cmd.OutOrStdout(), "✓ %s: refreshed ID-JAG with %d scope(s)\n",
					issued.Domain, len(scopeFields(issued.Scope)))
			}

			project, err := selectProject(cmd.InOrStdin(), cmd.OutOrStdout(), defaultProjectChoices(idJAGs))
			if err != nil {
				return err
			}
			idJAG, _, err := eligibleScopesForProject(idJAGs, project)
			if err != nil {
				return err
			}
			scopes := freshScopes[project]
			var scope string
			if len(scopes) == 1 {
				scope = scopes[0]
			} else {
				scope, err = selectScope(cmd.InOrStdin(), cmd.OutOrStdout(), scopes)
				if err != nil {
					return err
				}
			}
			if !containsScope(scopes, scope) {
				return fmt.Errorf("selected scope %q is not currently eligible for GenAI project %q", scope, project)
			}

			accessToken, err := issueAccessToken(cmd.Context(), cfg, svc, idJAG, project, scope)
			if err != nil {
				return fmt.Errorf("issuing selected GenAI access token: %w", err)
			}
			if err := config.SaveDefaultProject(resolved.Path, project); err != nil {
				return err
			}
			entry.IDJAGs = idJAGs
			entry.AccessToken = accessToken
			if err := cache.Save(svcName, *entry); err != nil {
				return fmt.Errorf("caching selected GenAI access token: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "✓ Saved gen_ai.default_project %q to %s\n", project, resolved.Path)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Access token issued and cached for project %s with scope %s\n", project, scope)
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}
