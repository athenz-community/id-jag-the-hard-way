package version_test

import (
	"testing"

	"github.com/AthenZ/athenzd/internal/version"
)

// TestVersion_NotEmpty guards against accidentally blanking the version constant.
func TestVersion_NotEmpty(t *testing.T) {
	if version.Version == "" {
		t.Fatal("Version must not be empty")
	}
}
