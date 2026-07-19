package config

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestSaveDefaultProjectWriteErrors(t *testing.T) {
	path := writeUpdateTestConfig(t)
	originalMarshal, originalStat, originalWrite := marshalYAML, statConfigFile, writeConfigFile
	t.Cleanup(func() {
		marshalYAML, statConfigFile, writeConfigFile = originalMarshal, originalStat, originalWrite
	})

	marshalYAML = func(any) ([]byte, error) { return nil, fmt.Errorf("marshal failed") }
	if err := SaveDefaultProject(path, "docs"); err == nil || !strings.Contains(err.Error(), "encoding config") {
		t.Fatalf("unexpected marshal error: %v", err)
	}
	marshalYAML = originalMarshal

	statConfigFile = func(string) (os.FileInfo, error) { return nil, fmt.Errorf("stat failed") }
	if err := SaveDefaultProject(path, "docs"); err == nil || !strings.Contains(err.Error(), "permissions") {
		t.Fatalf("unexpected stat error: %v", err)
	}
	statConfigFile = originalStat

	writeConfigFile = func(string, []byte, os.FileMode) error { return fmt.Errorf("write failed") }
	if err := SaveDefaultProject(path, "docs"); err == nil || !strings.Contains(err.Error(), "saving default") {
		t.Fatalf("unexpected write error: %v", err)
	}
}

func writeUpdateTestConfig(t *testing.T) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("gen_ai:\n  domain: gen-ai.services.{{project}}\n  role: gen-ai-users\n"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return file.Name()
}
