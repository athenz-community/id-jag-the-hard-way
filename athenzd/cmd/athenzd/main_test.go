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
