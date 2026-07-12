package main

import (
	"fmt"

	"github.com/AthenZ/athenzd/internal/version"
	"github.com/spf13/cobra"
)

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "athenzd",
		Short: "Athenz identity daemon — cert rotation, token exchange, proxy",
		// No Run: athenzd with no subcommand will eventually start the daemon.
		// For now it just prints help.
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
		SilenceErrors: true,
		SilenceUsage:  true,
	}

	root.AddCommand(newVersionCmd())
	return root
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintf(cmd.OutOrStdout(), "athenzd v%s\n", version.Version)
		},
	}
}

func main() {
	cmd := newRootCmd()
	if err := cmd.Execute(); err != nil {
		_ = cmd.Help()
	}
}
