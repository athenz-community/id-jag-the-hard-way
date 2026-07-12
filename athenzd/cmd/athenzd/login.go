package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/login"
	"github.com/spf13/cobra"
)

func newLoginCmd() *cobra.Command {
	return newLoginCmdWithBrowser(openBrowser)
}

func newLoginCmdWithBrowser(browserFn func(string) error) *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate via browser (PKCE) and cache the ID token",
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

			result, err := login.Run(cmd.Context(), login.Config{
				Issuer:       svc.IDP.Issuer,
				ClientID:     svc.IDP.ClientID,
				CallbackPort: svc.IDP.CallbackPort,
			}, browserFn)
			if err != nil {
				return fmt.Errorf("login failed: %w", err)
			}

			if err := cache.Save(svcName, cache.TokenEntry{
				IDToken:   result.IDToken,
				ExpiresAt: result.ExpiresAt,
			}); err != nil {
				return fmt.Errorf("saving token: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Logged in as service %q — token cached until %s\n",
				svcName, result.ExpiresAt.Format(time.RFC3339))
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}

func findService(cfg *config.Config, name string) (*config.ServiceConfig, error) {
	for i := range cfg.Services {
		if cfg.Services[i].Name == name {
			return &cfg.Services[i], nil
		}
	}
	return nil, fmt.Errorf("service %q not found in config", name)
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
	default:
		return fmt.Errorf("unsupported OS for browser open: %s", goos)
	}
	return cmd.Start()
}
