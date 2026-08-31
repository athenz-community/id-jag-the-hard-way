package main

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/spf13/cobra"
)

func newLogoutCmd() *cobra.Command {
	return newLogoutCmdWithBrowser(openBrowser)
}

func newLogoutCmdWithBrowser(browserFn func(string) error) *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "logout",
		Short: "Clear the current cached credentials and sign out from the identity provider",
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
			svcName := cfg.CurrentService
			if svcName == "" {
				return fmt.Errorf("current_service is not set in config")
			}
			svc, err := findService(cfg, svcName)
			if err != nil {
				return err
			}

			var idToken string
			if entry, loadErr := cache.Load(svcName); loadErr == nil {
				idToken = entry.IDToken
			}
			logoutURL, err := idpLogoutURL(svc.IDP.Issuer, svc.IDP.ClientID, idToken)
			if err != nil {
				return err
			}

			removed, err := cache.Delete(svcName)
			if err != nil {
				return fmt.Errorf("clearing cached credentials for %q: %w", svcName, err)
			}
			if removed {
				fmt.Fprintf(cmd.OutOrStdout(), "✓ Cached credentials cleared for current_service %q\n", svcName)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "✓ No cached credentials found for current_service %q\n", svcName)
			}

			fmt.Fprintln(cmd.OutOrStdout(), "Opening browser to sign out from the identity provider...")
			if err := browserFn(logoutURL); err != nil {
				return fmt.Errorf("local credentials were cleared, but opening browser for identity-provider logout: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "✓ Identity-provider logout opened in the browser")
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}

func idpLogoutURL(issuer, clientID, idToken string) (string, error) {
	endpoint := strings.TrimRight(issuer, "/") + "/protocol/openid-connect/logout"
	logoutURL, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("building identity-provider logout URL: %w", err)
	}
	if logoutURL.Scheme == "" || logoutURL.Host == "" {
		return "", fmt.Errorf("building identity-provider logout URL: issuer %q is not an absolute URL", issuer)
	}

	query := logoutURL.Query()
	query.Set("client_id", clientID)
	if idToken != "" {
		query.Set("id_token_hint", idToken)
	}
	logoutURL.RawQuery = query.Encode()
	return logoutURL.String(), nil
}
