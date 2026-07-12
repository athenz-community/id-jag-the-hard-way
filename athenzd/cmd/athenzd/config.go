package main

import (
	"fmt"

	"github.com/AthenZ/athenzd/internal/config"
	"github.com/spf13/cobra"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage athenzd configuration",
	}
	cmd.AddCommand(newConfigValidateCmd())
	return cmd
}

func newConfigValidateCmd() *cobra.Command {
	var file string

	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate a config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(file)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "OK\n")
			fmt.Fprintf(cmd.OutOrStdout(), "  zts:              %s\n", cfg.Athenz.ZTS)
			fmt.Fprintf(cmd.OutOrStdout(), "  zms:              %s\n", cfg.Athenz.ZMS)
			fmt.Fprintf(cmd.OutOrStdout(), "  current_service:  %s\n", cfg.CurrentService)
			fmt.Fprintf(cmd.OutOrStdout(), "  services (%d):\n", len(cfg.Services))
			for _, svc := range cfg.Services {
				fmt.Fprintf(cmd.OutOrStdout(), "    - name: %s  domain: %s  provider: %s\n",
					svc.Name, svc.Athenz.Domain, svc.Athenz.Provider)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&file, "file", "f", "athenzd.default.yaml", "path to config file")
	return cmd
}
