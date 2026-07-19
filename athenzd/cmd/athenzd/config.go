package main

import (
	"fmt"

	"github.com/AthenZ/athenzd/internal/config"
	"github.com/spf13/cobra"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "config",
		Aliases: []string{"cfg"},
		Short:   "Manage athenzd configuration",
	}
	cmd.AddCommand(newConfigValidateCmd())
	cmd.AddCommand(newConfigCurrentCmd())
	return cmd
}

func newConfigValidateCmd() *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate a config file",
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
			fmt.Fprintf(cmd.OutOrStdout(), "OK\n")
			fmt.Fprintf(cmd.OutOrStdout(), "  zts:              %s\n", cfg.Athenz.ZTS)
			fmt.Fprintf(cmd.OutOrStdout(), "  zms:              %s\n", cfg.Athenz.ZMS)
			fmt.Fprintf(cmd.OutOrStdout(), "  ca_file:          %s\n", cfg.Athenz.CAFile)
			fmt.Fprintf(cmd.OutOrStdout(), "  current_service:  %s\n", cfg.CurrentService)
			fmt.Fprintf(cmd.OutOrStdout(), "  services (%d):\n", len(cfg.Services))
			for _, svc := range cfg.Services {
				fmt.Fprintf(cmd.OutOrStdout(), "    - name: %s  service: %s\n",
					svc.Name, svc.Athenz.Service)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}

func newConfigCurrentCmd() *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:     "current-config",
		Aliases: []string{"now"},
		Short:   "Show which config file is active and where it came from",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved, err := config.Resolve(file)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n", resolved.Path)
			fmt.Fprintf(cmd.OutOrStdout(), "source: %s\n", resolved.Source)
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "", "path to config file (default: .athenzd/config.yaml or ~/.athenzd/config.yaml)")
	return cmd
}
