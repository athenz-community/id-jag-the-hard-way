package main

import (
	"fmt"
	"os"

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
		// Silence default error/usage printing — we handle it in main() for cleaner output.
		SilenceErrors: true,
		SilenceUsage:  true,
	}

	root.AddCommand(newVersionCmd())
	root.AddCommand(newConfigCmd())
	root.AddCommand(newLoginCmd())
	root.AddCommand(newLogoutCmd())
	root.AddCommand(newSetCmd())
	root.AddCommand(newWhoamiCmd())
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

// run is extracted from main so the error path is testable without os.Exit.
func run(args []string) error {
	cmd := newRootCmd()
	cmd.SetArgs(args)
	return cmd.Execute()
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
