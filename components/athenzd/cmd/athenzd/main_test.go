package main

import (
	"bytes"
	"strings"
	"testing"
)

// TestVersionCommand_Output checks that `athenzd version` prints "athenzd v<something>".
// We wire a buffer as stdout so we can assert the output without capturing os.Stdout.
func TestVersionCommand_Output(t *testing.T) {
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"version"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()
	if !strings.HasPrefix(got, "athenzd v") {
		t.Errorf("expected output to start with 'athenzd v', got: %q", got)
	}
}

// TestRun_NoArgs checks that `athenzd` with no args prints help (exits 0).
func TestRun_NoArgs(t *testing.T) {
	if err := run([]string{}); err != nil {
		t.Fatalf("expected no error with no args, got: %v", err)
	}
}

// TestRun_ErrorPath checks that an invalid command returns an error via run().
func TestRun_ErrorPath(t *testing.T) {
	// "config validate" with a non-existent file should surface an error through run().
	err := run([]string{"config", "validate", "-f", "/tmp/does-not-exist-athenzd.yaml"})
	if err == nil {
		t.Fatal("expected error for missing config file, got nil")
	}
}
