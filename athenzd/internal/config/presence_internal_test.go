package config

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestConfigKeyPresent(t *testing.T) {
	for _, test := range []struct {
		name    string
		content string
		want    bool
		wantErr bool
	}{
		{"present null", "gen_ai: null\n", true, false},
		{"absent", "athenz: {}\n", false, false},
		{"empty document", "", false, false},
		{"non-mapping", "- item\n", false, false},
		{"invalid yaml", "[", false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := writePresenceConfig(t, test.content)
			got, err := configKeyPresent(path, "gen_ai")
			if (err != nil) != test.wantErr || got != test.want {
				t.Fatalf("present=%v err=%v", got, err)
			}
		})
	}
	if _, err := configKeyPresent(t.TempDir()+"/missing", "gen_ai"); err == nil {
		t.Fatal("expected read error")
	}
}

func TestLoadResolvedConfigPresenceError(t *testing.T) {
	path := writePresenceConfig(t, "athenz:\n  zts: https://zts.example.test\n")
	original := readConfigForPresence
	t.Cleanup(func() { readConfigForPresence = original })
	readConfigForPresence = func(string) ([]byte, error) { return nil, fmt.Errorf("presence failed") }
	_, err := LoadResolved(&ResolveResult{Path: path, Source: SourceExplicit})
	if err == nil || !strings.Contains(err.Error(), "inspecting config structure") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func writePresenceConfig(t *testing.T, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "presence-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return file.Name()
}
