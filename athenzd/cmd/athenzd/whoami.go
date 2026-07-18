package main

import (
	"fmt"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/jwt"
	"github.com/spf13/cobra"
)

func newWhoamiCmd() *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "whoami",
		Short: "Show the identity from the cached ID token",
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

			entry, err := cache.Load(svcName)
			if err != nil {
				return fmt.Errorf("no cached token for %q — run `athenzd login` first: %w", svcName, err)
			}

			claims, err := jwt.Decode(entry.IDToken)
			if err != nil {
				return fmt.Errorf("decoding cached token: %w", err)
			}

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "service:   %s\n", svcName)
			fmt.Fprintf(out, "user:      %s\n", claims.PreferredUsername)
			fmt.Fprintf(out, "issuer:    %s\n", claims.Issuer)
			fmt.Fprintf(out, "audience:  %s\n", claims.Audience)
			if claims.Email != "" {
				fmt.Fprintf(out, "email:     %s\n", claims.Email)
			}
			fmt.Fprintf(out, "expires:   %s (%s)\n",
				entry.ExpiresAt.Format(time.RFC3339),
				humanizeRemaining(entry.ExpiresAt, time.Now()))
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}
