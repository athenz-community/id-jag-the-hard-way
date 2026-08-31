package genai

import (
	"strings"
	"testing"
)

func TestDomainMatcher(t *testing.T) {
	for _, template := range []string{" gen-ai.services.{{project}} ", "gen-ai.services.{{.project}}"} {
		matcher, err := ParseDomainTemplate(template)
		if err != nil {
			t.Fatal(err)
		}
		if service, ok := matcher.Match("gen-ai.services.mail"); !ok || service != "mail" {
			t.Fatalf("service=%q ok=%v", service, ok)
		}
		for _, domain := range []string{"other.services.mail", "gen-ai.services.", "gen-ai.services.bad.name", "gen-ai.services.bad+name"} {
			if service, ok := matcher.Match(domain); ok || service != "" {
				t.Fatalf("expected %q not to match, got %q", domain, service)
			}
		}
	}
}

func TestParseDomainTemplateErrors(t *testing.T) {
	for _, template := range []string{
		"gen-ai.services", "{{project}}.{{project}}", "gen-ai+services.{{project}}", "gen-ai /{{project}}", ".{{project}}", "{{project}}.", "gen-ai.services.{{service}}",
	} {
		if _, err := ParseDomainTemplate(template); err == nil || !strings.Contains(err.Error(), "GenAI domain") {
			t.Fatalf("expected template error for %q, got %v", template, err)
		}
	}
}

func TestRoleAndScopeHelpers(t *testing.T) {
	if err := ValidateService("athenz"); err != nil {
		t.Fatal(err)
	}
	for _, service := range []string{"", "bad.project", " bad"} {
		if err := ValidateService(service); err == nil || !strings.Contains(err.Error(), "GenAI project") {
			t.Fatalf("expected project error for %q, got %v", service, err)
		}
	}
	if err := ValidateRole(" gen-ai-users "); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"", "bad+role", "reader-jag-exchangers"} {
		if err := ValidateRole(role); err == nil || !strings.Contains(err.Error(), "GenAI role") {
			t.Fatalf("expected role error for %q, got %v", role, err)
		}
	}
	if got := Scope("gen-ai.services.mail", "reader"); got != "gen-ai.services.mail:role.reader" {
		t.Fatalf("scope=%q", got)
	}
	domain, role, ok := SplitScope("gen-ai.services.mail:role.reader")
	if !ok || domain != "gen-ai.services.mail" || role != "reader" {
		t.Fatalf("domain=%q role=%q ok=%v", domain, role, ok)
	}
	for _, scope := range []string{"reader", ":role.reader", "api:role.bad+role", "api:role.reader:role.writer"} {
		if _, _, ok := SplitScope(scope); ok {
			t.Fatalf("expected invalid scope %q", scope)
		}
	}
}

func TestTargetFromExchanger(t *testing.T) {
	if scope, ok := TargetFromExchanger("gen-ai.services.athenz", "gen-ai.services.athenz:role.docs-reader-jag-exchangers"); !ok || scope != "gen-ai.services.athenz:role.docs-reader" {
		t.Fatalf("scope=%q ok=%v", scope, ok)
	}
	for _, role := range []string{
		"not-a-scope",
		"gen-ai.services.mail:role.docs-reader-jag-exchangers",
		"gen-ai.services.athenz:role.docs-reader",
		"gen-ai.services.athenz:role.-jag-exchangers",
	} {
		if scope, ok := TargetFromExchanger("gen-ai.services.athenz", role); ok || scope != "" {
			t.Fatalf("expected %q not to map, got %q", role, scope)
		}
	}
}
