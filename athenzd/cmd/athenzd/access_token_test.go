package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"golang.org/x/term"
)

const testDefaultProject = "athenz"

func TestIssueDefaultAccessToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("assertion") != "id-jag-token" || r.Form.Get("scope") != testBaselineScope {
			t.Errorf("unexpected access-token form: %v", r.Form)
		}
		token := fakeIDToken(`{"sub":"user.alice","scope":"` + testBaselineScope + `"}`)
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   3600,
			"scope":        testBaselineScope,
		})
	}))
	defer server.Close()
	certFile, keyFile := writeIDJAGClientPair(t)
	cfg := &config.Config{
		Athenz: config.AthenzCore{ZTS: server.URL},
		GenAI:  config.GenAIConfig{Role: testBaselineRole},
		Services: []config.ServiceConfig{{
			Identity: config.IdentityConfig{CertFile: certFile, KeyFile: keyFile},
		}},
	}
	idJAGs := map[string]cache.IDJAGEntry{
		"athenz": {
			Service: "athenz",
			Domain:  "gen-ai.services.athenz",
			Token:   "id-jag-token",
			Scope:   "gen-ai.services.athenz:role.docs-reader " + testBaselineScope,
		},
	}
	before := time.Now().Add(59 * time.Minute)
	entry, err := issueDefaultAccessToken(context.Background(), cfg, &cfg.Services[0], idJAGs, testDefaultProject)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Project != testDefaultProject || entry.Scope != testBaselineScope || entry.Token == "" || entry.TokenType != "Bearer" || entry.ExpiresAt.Before(before) {
		t.Fatalf("unexpected cached access token: %+v", entry)
	}
}

func TestDefaultProjectChoicesAndLookup(t *testing.T) {
	entries := map[string]cache.IDJAGEntry{
		"mail":   {Service: "mail", Domain: "gen-ai.services.mail", Scope: "gen-ai.services.mail:role.gen-ai-users"},
		"athenz": {Service: "athenz", Domain: "gen-ai.services.athenz", Scope: testBaselineScope + " gen-ai.services.athenz:role.docs-reader"},
	}
	want := []string{"athenz", "mail"}
	if got := defaultProjectChoices(entries); !reflect.DeepEqual(got, want) {
		t.Fatalf("choices=%v want=%v", got, want)
	}
	entry, scope, err := idJAGForProject(entries, testDefaultProject, testBaselineRole)
	if err != nil || entry.Domain != "gen-ai.services.athenz" || scope != testBaselineScope {
		t.Fatalf("entry=%+v scope=%q err=%v", entry, scope, err)
	}
	for _, test := range []struct {
		project string
		want    string
	}{
		{"bad+project", "not a valid"},
		{"missing", "not eligible"},
	} {
		if _, _, err := idJAGForProject(entries, test.project, testBaselineRole); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("project %q: expected %q, got %v", test.project, test.want, err)
		}
	}
	entries["athenz"] = cache.IDJAGEntry{Service: "athenz", Domain: "gen-ai.services.athenz", Scope: "gen-ai.services.athenz:role.docs-reader"}
	if _, _, err := idJAGForProject(entries, "athenz", testBaselineRole); err == nil || !strings.Contains(err.Error(), "baseline scope") {
		t.Fatalf("unexpected missing-baseline error: %v", err)
	}
}

func TestIssueDefaultAccessTokenErrors(t *testing.T) {
	cfg := &config.Config{Athenz: config.AthenzCore{ZTS: "https://zts.example.test"}, GenAI: config.GenAIConfig{Role: testBaselineRole}, Services: []config.ServiceConfig{{
		Identity: config.IdentityConfig{CertFile: "missing", KeyFile: "missing"},
	}}}
	entries := map[string]cache.IDJAGEntry{"athenz": {Service: "athenz", Domain: "gen-ai.services.athenz", Token: "id-jag", Scope: testBaselineScope}}
	if _, err := issueDefaultAccessToken(context.Background(), cfg, &cfg.Services[0], entries, "bad+project"); err == nil || !strings.Contains(err.Error(), "not a valid") {
		t.Fatalf("unexpected project error: %v", err)
	}
	if _, err := issueDefaultAccessToken(context.Background(), cfg, &cfg.Services[0], entries, testDefaultProject); err == nil || !strings.Contains(err.Error(), "creating X.509-authenticated") {
		t.Fatalf("unexpected identity error: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "denied", http.StatusForbidden)
	}))
	defer server.Close()
	certFile, keyFile := writeIDJAGClientPair(t)
	cfg.Athenz.ZTS = server.URL
	cfg.Services[0].Identity.CertFile = certFile
	cfg.Services[0].Identity.KeyFile = keyFile
	if _, err := issueDefaultAccessToken(context.Background(), cfg, &cfg.Services[0], entries, testDefaultProject); err == nil || !strings.Contains(err.Error(), "issuing default GenAI access token") {
		t.Fatalf("unexpected exchange error: %v", err)
	}
}

func TestCacheLoginAccessTokenError(t *testing.T) {
	t.Setenv("HOME", "")
	entry := &cache.TokenEntry{AccessToken: &cache.AccessTokenEntry{Project: testDefaultProject, Scope: testBaselineScope}}
	if err := cacheLoginAccessToken("profile", entry); err == nil || !strings.Contains(err.Error(), "caching default GenAI access token") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunProjectPrompt(t *testing.T) {
	choices := []string{"first", "second", "third"}
	for _, test := range []struct {
		name  string
		input string
		want  string
	}{
		{"down", "\x1b[B\r", "second"},
		{"up wraps", "\x1b[A\r", "third"},
		{"enter", "\r", "first"},
	} {
		t.Run(test.name, func(t *testing.T) {
			out := &bytes.Buffer{}
			got, err := runProjectPrompt(strings.NewReader(test.input), out, choices)
			output := out.String()
			if err != nil || got != test.want || !strings.Contains(output, "Which GenAI project") {
				t.Fatalf("got=%q output=%q err=%v", got, out.String(), err)
			}
			if strings.Contains(strings.ReplaceAll(output, "\r\n", ""), "\n") ||
				!strings.Contains(output, "\r\x1b[2KSelected: "+test.want+"\r\n") {
				t.Fatalf("prompt did not use raw-terminal line endings: %q", output)
			}
		})
	}
	if _, err := runProjectPrompt(strings.NewReader(""), &bytes.Buffer{}, nil); err == nil {
		t.Fatal("expected empty-choice error")
	}
	if _, err := promptDefaultProject(strings.NewReader("\r"), &bytes.Buffer{}, choices); err == nil || !strings.Contains(err.Error(), "interactive terminal") {
		t.Fatalf("unexpected non-terminal error: %v", err)
	}
	if _, err := runProjectPrompt(strings.NewReader("\x03"), &bytes.Buffer{}, choices); err == nil || !strings.Contains(err.Error(), "canceled") {
		t.Fatalf("unexpected cancel error: %v", err)
	}
	if _, err := runProjectPrompt(strings.NewReader("\x1b"), &bytes.Buffer{}, choices); err == nil || !strings.Contains(err.Error(), "reading") {
		t.Fatalf("unexpected short-sequence error: %v", err)
	}
	if _, err := runProjectPrompt(strings.NewReader(""), &bytes.Buffer{}, choices); err == nil || !strings.Contains(err.Error(), "reading") {
		t.Fatalf("unexpected input error: %v", err)
	}
	if got, err := runProjectPrompt(strings.NewReader("\x1bX?\r"), &bytes.Buffer{}, choices); err != nil || got != "first" {
		t.Fatalf("invalid escape should be ignored: got=%q err=%v", got, err)
	}
	if got, err := runProjectPrompt(strings.NewReader("\x1b[C\r"), &bytes.Buffer{}, choices); err != nil || got != "first" {
		t.Fatalf("unsupported arrow should be ignored: got=%q err=%v", got, err)
	}
}

func TestPromptDefaultProjectTerminal(t *testing.T) {
	originalIsTerminal, originalMakeRaw, originalRestore := isTerminal, makeRaw, restore
	t.Cleanup(func() {
		isTerminal, makeRaw, restore = originalIsTerminal, originalMakeRaw, originalRestore
	})
	input, err := os.CreateTemp(t.TempDir(), "selection")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if _, err := input.WriteString("\r"); err != nil {
		t.Fatal(err)
	}
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	isTerminal = func(int) bool { return true }
	makeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
	restored := false
	restore = func(int, *term.State) error { restored = true; return nil }
	choice, err := promptDefaultProject(input, &bytes.Buffer{}, []string{"docs"})
	if err != nil || choice != "docs" || !restored {
		t.Fatalf("choice=%q restored=%v err=%v", choice, restored, err)
	}

	makeRaw = func(int) (*term.State, error) { return nil, fmt.Errorf("raw failed") }
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if _, err := promptDefaultProject(input, &bytes.Buffer{}, []string{"docs"}); err == nil || !strings.Contains(err.Error(), "enabling") {
		t.Fatalf("unexpected make-raw error: %v", err)
	}
	if _, err := promptDefaultProject(input, &bytes.Buffer{}, nil); err == nil || !strings.Contains(err.Error(), "no eligible") {
		t.Fatalf("unexpected empty-choice error: %v", err)
	}
}

func Example_runProjectPrompt() {
	choice, _ := runProjectPrompt(strings.NewReader("\x1b[B\r"), &bytes.Buffer{}, []string{"docs", "mail"})
	fmt.Println(choice)
	// Output: mail
}
