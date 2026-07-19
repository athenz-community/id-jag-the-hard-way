package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/jwt"
	"github.com/AthenZ/athenzd/internal/login"
	"github.com/AthenZ/athenzd/internal/zms"
	"github.com/spf13/cobra"
)

func newLoginCmd() *cobra.Command {
	return newLoginCmdWithBrowser(openBrowser)
}

func newLoginCmdWithBrowser(browserFn func(string) error) *cobra.Command {
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

			fmt.Fprintln(cmd.OutOrStdout(), "Step 1/2 — Log in with the identity provider")
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

			if err := cache.Save(svcName, cache.TokenEntry{
				IDToken:   result.IDToken,
				ExpiresAt: result.ExpiresAt,
			}); err != nil {
				return fmt.Errorf("saving token: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "✓ ID token cached for current_service %q until %s (%s)\n",
				svcName, result.ExpiresAt.Format(time.RFC3339),
				humanizeRemaining(result.ExpiresAt, time.Now()))

			fmt.Fprintf(cmd.OutOrStdout(), "\nStep 2/2 — Ensure Athenz service %s\n", target.ServiceIdentity)
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
			fmt.Fprintf(cmd.OutOrStdout(), "✓ Ready: %s\n", target.ServiceIdentity)
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
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
