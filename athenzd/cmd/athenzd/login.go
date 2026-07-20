package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/genaiproxy"
	"github.com/AthenZ/athenzd/internal/jwt"
	"github.com/AthenZ/athenzd/internal/login"
	"github.com/AthenZ/athenzd/internal/zms"
	"github.com/AthenZ/athenzd/internal/zts"
	"github.com/spf13/cobra"
)

func newLoginCmd() *cobra.Command {
	return newLoginCmdWithBrowserAndSelector(openBrowser, promptDefaultProject)
}

func newLoginCmdWithBrowser(browserFn func(string) error) *cobra.Command {
	return newLoginCmdWithBrowserAndSelector(browserFn, promptDefaultProject)
}

func newLoginCmdWithBrowserAndSelector(browserFn func(string) error, selector projectSelector) *cobra.Command {
	return newLoginCmdWithDependencies(browserFn, selector, genaiproxy.EnsureDaemon)
}

func newLoginCmdWithDependencies(browserFn func(string) error, selector projectSelector, proxyManager genAIProxyManager) *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Log in and ensure the configured local Athenz service",
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
			if cfg.Athenz.ZMS == "" {
				return fmt.Errorf("athenz.zms is required for login")
			}
			stepCount := 2
			issueIDJAGAfterEnrollment := false
			if svc.Identity.Mode == config.IdentityModeCopperArgos {
				stepCount = 3
				if cfg.GenAI.Domain != "" && cfg.GenAI.Role != "" {
					stepCount = 4
					issueIDJAGAfterEnrollment = true
				}
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Step 1/%d — Log in with the identity provider\n", stepCount)
			result, err := login.Run(cmd.Context(), login.Config{
				Issuer:       svc.IDP.Issuer,
				ClientID:     svc.IDP.ClientID,
				CallbackPort: svc.IDP.CallbackPort,
				CAFile:       svc.IDP.CAFile,
			}, browserFn)
			if err != nil {
				return fmt.Errorf("login failed: %w", err)
			}

			claims, err := jwt.Decode(result.IDToken)
			if err != nil {
				return fmt.Errorf("reading identity from ID token: %w", err)
			}
			target, err := zms.ResolveTarget(svc.Athenz.Service, claims.PreferredUsername)
			if err != nil {
				return fmt.Errorf("deriving Athenz service from ID token: %w", err)
			}

			cacheEntry := cache.TokenEntry{
				IDToken:   result.IDToken,
				ExpiresAt: result.ExpiresAt,
			}
			if err := cache.Save(svcName, cacheEntry); err != nil {
				return fmt.Errorf("saving token: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "✓ ID token cached for current_service %q until %s (%s)\n",
				svcName, result.ExpiresAt.Format(time.RFC3339),
				humanizeRemaining(result.ExpiresAt, time.Now()))

			fmt.Fprintf(cmd.OutOrStdout(), "\nStep 2/%d — Ensure Athenz service %s\n", stepCount, target.ServiceIdentity)
			zmsClient, err := zms.NewClient(cfg.Athenz.ZMS, cfg.Athenz.CAFile)
			if err != nil {
				return fmt.Errorf("creating ZMS client: %w", err)
			}
			report, err := zmsClient.Ensure(cmd.Context(), result.IDToken, target, svc.Athenz.OptionalAdmins)
			if err != nil {
				return fmt.Errorf("ensuring Athenz service %s: %w", target.ServiceIdentity, err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "✓ Required parent exists: %s\n", target.ParentDomain)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Local subdomain %s: %s\n", target.Domain, ensureState(report.SubdomainCreated))
			for _, admin := range report.OptionalAdmins {
				fmt.Fprintf(cmd.OutOrStdout(), "✓ Optional administrator %s: %s\n", admin.Name, membershipState(admin.Added))
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Service %s: %s\n", target.ServiceIdentity, ensureState(report.ServiceCreated))

			if svc.Identity.Mode != config.IdentityModeCopperArgos {
				fmt.Fprintf(cmd.OutOrStdout(), "✓ Ready: %s\n", target.ServiceIdentity)
				return ensureConfiguredGenAIProxy(cmd.Context(), cfg, resolved.Path, &cacheEntry, cmd.OutOrStdout(), proxyManager)
			}

			providerAuthorized, err := zmsClient.EnsureProviderAuthorization(
				cmd.Context(), result.IDToken, target, svc.Athenz.Provider)
			if err != nil {
				return fmt.Errorf("authorizing instance provider %s for %s: %w",
					svc.Athenz.Provider, target.ServiceIdentity, err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Provider launch authorization %s: %s\n",
				svc.Athenz.Provider, authorizationState(providerAuthorized))
			if providerAuthorized {
				fmt.Fprintln(cmd.OutOrStdout(), "  Waiting up to 60s for ZTS to observe the new authorization...")
			}

			fmt.Fprintf(cmd.OutOrStdout(), "\nStep 3/%d — Enroll X.509 identity through %s\n", stepCount, svc.Athenz.Provider)
			ztsClient, err := zts.NewClient(cfg.Athenz.ZTS, cfg.Athenz.CAFile)
			if err != nil {
				return fmt.Errorf("creating ZTS client: %w", err)
			}
			enrollRequest := zts.EnrollRequest{
				Provider:        svc.Athenz.Provider,
				Domain:          target.Domain,
				Service:         target.ServiceName,
				InstanceID:      svc.Identity.InstanceID,
				AttestationData: result.IDToken,
				ExpiryMinutes:   svc.Identity.ExpiryMinutes,
				CertFile:        svc.Identity.CertFile,
				KeyFile:         svc.Identity.KeyFile,
				CAFile:          svc.Identity.CAFile,
			}
			identity, err := enrollWithPolicySync(cmd.Context(), providerAuthorized, 5*time.Second,
				func() (*zts.Identity, error) {
					return ztsClient.Enroll(cmd.Context(), enrollRequest)
				})
			if err != nil {
				return fmt.Errorf("enrolling X.509 identity for %s: %w", target.ServiceIdentity, err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "✓ Certificate issued: %s (instance %s)\n", identity.Name, identity.InstanceID)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Certificate: %s\n", svc.Identity.CertFile)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Private key: %s\n", svc.Identity.KeyFile)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Signer CA: %s\n", svc.Identity.CAFile)
			if issueIDJAGAfterEnrollment {
				fmt.Fprintln(cmd.OutOrStdout(), "\nStep 4/4 — Issue ID-JAGs for all eligible GenAI service-project roles")
				idJAGs, issueErr := issueIDJAGs(cmd.Context(), cfg, svc, result.IDToken, target, func(projects []genai.ServiceScopes) {
					for _, line := range formatEligibleRoles(target.UserPrincipal, projects) {
						fmt.Fprintln(cmd.OutOrStdout(), line)
					}
				})
				if issueErr == nil {
					issueErr = cacheLoginIDJAGs(svcName, &cacheEntry, idJAGs)
				}
				if issueErr != nil {
					fmt.Fprintln(cmd.ErrOrStderr(), idJAGSkipLog(issueErr))
				} else {
					for _, entry := range sortedIDJAGs(idJAGs) {
						fmt.Fprintf(cmd.OutOrStdout(), "✓ %s: ID-JAG issued with %d scope(s): %s\n",
							entry.Domain, len(scopeFields(entry.Scope)), entry.Scope)
					}
					fmt.Fprintf(cmd.OutOrStdout(), "✓ %d ID-JAG(s) cached for current_service %q\n",
						len(idJAGs), svcName)

					project := cfg.GenAI.DefaultProject
					if project == "" {
						project, issueErr = selector(cmd.InOrStdin(), cmd.OutOrStdout(), defaultProjectChoices(idJAGs))
						if issueErr == nil {
							issueErr = config.SaveDefaultProject(resolved.Path, project)
						}
						if issueErr == nil {
							cfg.GenAI.DefaultProject = project
							fmt.Fprintf(cmd.OutOrStdout(), "✓ Saved gen_ai.default_project to %s\n", resolved.Path)
						}
					} else {
						fmt.Fprintf(cmd.OutOrStdout(), "✓ Default GenAI project: %s\n", project)
					}
					if issueErr == nil {
						cacheEntry.AccessToken, issueErr = issueDefaultAccessToken(cmd.Context(), cfg, svc, idJAGs, project)
					}
					if issueErr == nil {
						issueErr = cacheLoginAccessToken(svcName, &cacheEntry)
					}
					if issueErr != nil {
						fmt.Fprintf(cmd.ErrOrStderr(), "⚠ Default GenAI access token skipped — %v\n", issueErr)
					} else {
						fmt.Fprintf(cmd.OutOrStdout(), "✓ Default access token issued and cached for project %s with scope %s\n",
							project, cacheEntry.AccessToken.Scope)
						fmt.Fprintln(cmd.OutOrStdout(), "\nIf you want to change the active GenAI project or scope later, run:")
						fmt.Fprintf(cmd.OutOrStdout(), "  %sathenzd set genai-project%s\n", athenzFocusColor, resetColor)
					}
				}
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Ready: %s\n", target.ServiceIdentity)
			return ensureConfiguredGenAIProxy(cmd.Context(), cfg, resolved.Path, &cacheEntry, cmd.OutOrStdout(), proxyManager)
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}

func cacheLoginIDJAGs(serviceName string, entry *cache.TokenEntry, idJAGs map[string]cache.IDJAGEntry) error {
	entry.IDJAGs = idJAGs
	if err := cache.Save(serviceName, *entry); err != nil {
		return fmt.Errorf("caching issued ID-JAGs: %w", err)
	}
	return nil
}

const ztsPolicySyncAttempts = 13

func enrollWithPolicySync(ctx context.Context, authorizationChanged bool, retryDelay time.Duration,
	enroll func() (*zts.Identity, error)) (*zts.Identity, error) {
	attempts := 1
	if authorizationChanged {
		attempts = ztsPolicySyncAttempts
	}
	for attempt := 1; ; attempt++ {
		identity, err := enroll()
		if err == nil {
			return identity, nil
		}
		var registrationError *zts.RegistrationError
		if !errors.As(err, &registrationError) || registrationError.StatusCode != http.StatusForbidden || attempt == attempts {
			return nil, err
		}

		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func ensureState(changed bool) string {
	if changed {
		return "created"
	}
	return "already exists"
}

func membershipState(changed bool) string {
	if changed {
		return "added"
	}
	return "already present"
}

func authorizationState(changed bool) string {
	if changed {
		return "applied"
	}
	return "already present"
}

func findService(cfg *config.Config, name string) (*config.ServiceConfig, error) {
	for i := range cfg.Services {
		if cfg.Services[i].Name == name {
			return &cfg.Services[i], nil
		}
	}
	return nil, fmt.Errorf("service %q not found in config", name)
}

// humanizeRemaining renders the time between now and exp as a short, friendly
// string like "~3h left" or "~45m left". Pure (now is passed in) so it is testable.
func humanizeRemaining(exp, now time.Time) string {
	d := exp.Sub(now)
	if d <= 0 {
		return "expired"
	}
	if d >= time.Hour {
		return fmt.Sprintf("~%dh left", int(d.Hours()))
	}
	if d >= time.Minute {
		return fmt.Sprintf("~%dm left", int(d.Minutes()))
	}
	return "~<1m left"
}

// openBrowser launches the default browser for the given URL.
func openBrowser(url string) error {
	return openBrowserForOS(runtime.GOOS, url)
}

func openBrowserForOS(goos, url string) error {
	var cmd *exec.Cmd
	switch goos {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported OS for browser open: %s", goos)
	}
	return cmd.Start()
}
