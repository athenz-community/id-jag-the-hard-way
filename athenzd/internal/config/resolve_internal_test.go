package config

import (
	"fmt"
	"os"
	"testing"
)

// TestResolve_GetwdError covers the rare branch where the working directory
// cannot be resolved while a project-level config exists. We inject a failing
// getwd so the error path is exercised without needing an unreadable cwd.
func TestResolve_GetwdError(t *testing.T) {
	// A project-level config must exist for the getwd branch to be reached.
	tmp := t.TempDir()
	t.Chdir(tmp)
	if err := os.MkdirAll(".athenzd", 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(".athenzd/config.yaml", []byte(""), 0600); err != nil {
		t.Fatal(err)
	}

	orig := getwd
	getwd = func() (string, error) { return "", fmt.Errorf("injected getwd failure") }
	t.Cleanup(func() { getwd = orig })

	if _, err := Resolve(""); err == nil {
		t.Fatal("expected error when getwd fails, got nil")
	}
}
