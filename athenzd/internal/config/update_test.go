package config_test

import (
	"os"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/config"
)

func TestSaveDefaultProject(t *testing.T) {
	path := writeTemp(t, `# root comment
athenz:
  zts: https://zts.example.test/zts/v1
gen_ai:
  # discovery comment
  domain: gen-ai.services.{{project}}
  role: gen-ai-users
  default_domain_role: gen-ai.services.docs:role.gen-ai-users
`)
	project := "docs"
	if err := config.SaveDefaultProject(path, project); err != nil {
		t.Fatal(err)
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.GenAI.DefaultProject != project {
		t.Fatalf("default project=%q", loaded.GenAI.DefaultProject)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "# root comment") || !strings.Contains(string(data), "# discovery comment") {
		t.Fatalf("comments were not preserved:\n%s", data)
	}
	if strings.Contains(string(data), "default_domain_role:") {
		t.Fatalf("legacy default_domain_role was not removed:\n%s", data)
	}

	replacement := "mail"
	if err := config.SaveDefaultProject(path, replacement); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(path)
	if strings.Count(string(data), "default_project:") != 1 || !strings.Contains(string(data), replacement) {
		t.Fatalf("setting was not replaced:\n%s", data)
	}
}

func TestSaveDefaultProjectErrors(t *testing.T) {
	for _, test := range []struct {
		name    string
		content string
		want    string
	}{
		{"invalid yaml", "[", "parsing config"},
		{"non-mapping root", "- item\n", "root"},
		{"missing gen ai", "athenz: {}\n", "gen_ai"},
		{"non-mapping gen ai", "gen_ai: value\n", "gen_ai"},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := writeTemp(t, test.content)
			if err := config.SaveDefaultProject(path, "docs"); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
	if err := config.SaveDefaultProject(t.TempDir()+"/missing", "docs"); err == nil || !strings.Contains(err.Error(), "reading config") {
		t.Fatalf("unexpected missing-file error: %v", err)
	}
}
