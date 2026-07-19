package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
)

const testDocsScope = "gen-ai.services.athenz:role.docs-reader"

func TestSetGenAIProjectRefreshesRolesAndChangesScope(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	zmsServer := newSetGenAIZMSServer(t)
	defer zmsServer.Close()
	ztsServer := newSetGenAIZTSServer(t, false)
	defer ztsServer.Close()
	certFile, keyFile := writeIDJAGClientPair(t)
	path := writeSetConfig(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", certFile, keyFile,
		"profile", "home.{{.preferred_username}}.local.athenzd", true)
	cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))

	projectCalls, scopeCalls := 0, 0
	cmd := newSetGenAIProjectCmdWithSelectors(
		func(_ io.Reader, _ io.Writer, choices []string) (string, error) {
			projectCalls++
			if len(choices) != 1 || choices[0] != "athenz" {
				t.Fatalf("project choices=%v", choices)
			}
			return "athenz", nil
		},
		func(_ io.Reader, _ io.Writer, choices []string) (string, error) {
			scopeCalls++
			if len(choices) != 2 || !containsScope(choices, testDocsScope) || !containsScope(choices, testBaselineScope) {
				t.Fatalf("scope choices=%v", choices)
			}
			return testDocsScope, nil
		},
	)
	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}
	cmd.SetOut(out)
	cmd.SetErr(errOut)
	cmd.SetArgs([]string{"-f", path})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if projectCalls != 1 || scopeCalls != 1 {
		t.Fatalf("project calls=%d scope calls=%d", projectCalls, scopeCalls)
	}
	output := out.String()
	for _, want := range []string{
		"Refreshing eligible GenAI project roles from Athenz",
		"Eligible roles for user.alice",
		testBaselineScope,
		testDocsScope,
		"refreshed ID-JAG with 2 scope(s)",
		"Access token issued and cached for project athenz with scope " + testDocsScope,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("output missing %q:\n%s", want, output)
		}
	}
	if !strings.Contains(errOut.String(), "explicit (-f flag)") {
		t.Fatalf("missing config source: %q", errOut.String())
	}
	entry, err := cache.Load("profile")
	if err != nil || len(entry.IDJAGs) != 1 || entry.IDJAGs["athenz"].Scope != testDocsScope+" "+testBaselineScope ||
		entry.AccessToken == nil || entry.AccessToken.Project != "athenz" || entry.AccessToken.Scope != testDocsScope || entry.AccessToken.Token == "" {
		t.Fatalf("cached entry=%+v err=%v", entry, err)
	}
	cfg, err := config.Load(path)
	if err != nil || cfg.GenAI.DefaultProject != "athenz" {
		t.Fatalf("saved config=%+v err=%v", cfg, err)
	}
}

func TestSetGenAIProjectUsesOnlyScopeWithoutPrompt(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	zmsServer := newSetGenAIZMSServerWithOptionalDocs(t, false)
	defer zmsServer.Close()
	ztsServer := newSetGenAIZTSServer(t, false)
	defer ztsServer.Close()
	certFile, keyFile := writeIDJAGClientPair(t)
	path := writeSetConfig(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", certFile, keyFile,
		"profile", "home.{{.preferred_username}}.local.athenzd", true)
	cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))

	scopePrompted := false
	cmd := newSetGenAIProjectCmdWithSelectors(
		func(_ io.Reader, _ io.Writer, choices []string) (string, error) {
			if len(choices) != 1 || choices[0] != "athenz" {
				t.Fatalf("project choices=%v", choices)
			}
			return "athenz", nil
		},
		func(io.Reader, io.Writer, []string) (string, error) {
			scopePrompted = true
			return "", fmt.Errorf("scope prompt must not run")
		},
	)
	cmd.SetArgs([]string{"-f", path})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if scopePrompted {
		t.Fatal("single eligible scope should be selected automatically")
	}
	entry, err := cache.Load("profile")
	if err != nil || entry.AccessToken == nil || entry.AccessToken.Scope != testBaselineScope {
		t.Fatalf("cached entry=%+v err=%v", entry, err)
	}
}

func TestSetGenAIProjectPrerequisiteErrors(t *testing.T) {
	selector := func(io.Reader, io.Writer, []string) (string, error) {
		return "", fmt.Errorf("selector should not run")
	}

	t.Run("resolve", func(t *testing.T) {
		t.Setenv("HOME", "")
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		if err := cmd.Execute(); err == nil {
			t.Fatal("expected resolve error")
		}
	})
	t.Run("load", func(t *testing.T) {
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", t.TempDir() + "/missing.yaml"})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "reading config") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("gen ai disabled", func(t *testing.T) {
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"profile", "home.{{.preferred_username}}.local.athenzd", false)
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "gen_ai.domain") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("zms missing", func(t *testing.T) {
		path := writeSetConfig(t, "", "https://zts.example.test", "cert", "key",
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "athenz.zms") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("current service missing", func(t *testing.T) {
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"", "home.{{.preferred_username}}.local.athenzd", true)
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "current_service") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("unknown service", func(t *testing.T) {
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"missing", "home.{{.preferred_username}}.local.athenzd", true)
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "not found") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("cache missing", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "run `athenzd login` first") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("cache expired", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(-time.Minute))
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("cache malformed", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cacheSetIDToken(t, "profile", "not-a-jwt", time.Now().Add(time.Hour))
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "decoding cached ID token") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("target invalid", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, "https://zms.example.test", "https://zts.example.test", "cert", "key",
			"profile", "home.bob.local.athenzd", true)
		cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))
		cmd := newSetGenAIProjectCmdWithSelectors(selector, selector)
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "deriving Athenz service") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestSetGenAIProjectSelectionAndSaveErrors(t *testing.T) {
	zmsServer := newSetGenAIZMSServer(t)
	defer zmsServer.Close()
	ztsServer := newSetGenAIZTSServer(t, false)
	defer ztsServer.Close()
	deniedZTSServer := newSetGenAIZTSServer(t, true)
	defer deniedZTSServer.Close()
	certFile, keyFile := writeIDJAGClientPair(t)

	run := func(t *testing.T, zmsURL, ztsURL string, project projectSelector, scope scopeSelector) error {
		t.Helper()
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, zmsURL, ztsURL, certFile, keyFile,
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))
		cmd := newSetGenAIProjectCmdWithSelectors(project, scope)
		cmd.SetArgs([]string{"-f", path})
		return cmd.Execute()
	}
	validProject := func(io.Reader, io.Writer, []string) (string, error) { return "athenz", nil }
	validScope := func(io.Reader, io.Writer, []string) (string, error) { return testDocsScope, nil }

	t.Run("role refresh", func(t *testing.T) {
		err := run(t, "://bad", ztsServer.URL+"/zts/v1", validProject, validScope)
		if err == nil || !strings.Contains(err.Error(), "creating ZMS client") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("project selection", func(t *testing.T) {
		err := run(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1",
			func(io.Reader, io.Writer, []string) (string, error) { return "", fmt.Errorf("project canceled") }, validScope)
		if err == nil || !strings.Contains(err.Error(), "project canceled") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("project no longer eligible", func(t *testing.T) {
		err := run(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1",
			func(io.Reader, io.Writer, []string) (string, error) { return "mail", nil }, validScope)
		if err == nil || !strings.Contains(err.Error(), "not eligible") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("scope selection", func(t *testing.T) {
		err := run(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", validProject,
			func(io.Reader, io.Writer, []string) (string, error) { return "", fmt.Errorf("scope canceled") })
		if err == nil || !strings.Contains(err.Error(), "scope canceled") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("scope no longer eligible", func(t *testing.T) {
		err := run(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", validProject,
			func(io.Reader, io.Writer, []string) (string, error) {
				return "gen-ai.services.athenz:role.removed", nil
			})
		if err == nil || !strings.Contains(err.Error(), "not currently eligible") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("access token", func(t *testing.T) {
		err := run(t, zmsServer.URL+"/zms/v1", deniedZTSServer.URL+"/zts/v1", validProject, validScope)
		if err == nil || !strings.Contains(err.Error(), "issuing selected GenAI access token") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("config save", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		path := writeSetConfig(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", certFile, keyFile,
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))
		cmd := newSetGenAIProjectCmdWithSelectors(func(io.Reader, io.Writer, []string) (string, error) {
			return "athenz", nil
		}, func(io.Reader, io.Writer, []string) (string, error) {
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			return testDocsScope, nil
		})
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "reading config to save") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("cache save", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		path := writeSetConfig(t, zmsServer.URL+"/zms/v1", ztsServer.URL+"/zts/v1", certFile, keyFile,
			"profile", "home.{{.preferred_username}}.local.athenzd", true)
		cacheSetIDToken(t, "profile", fakeIDToken(`{"preferred_username":"alice"}`), time.Now().Add(time.Hour))
		cmd := newSetGenAIProjectCmdWithSelectors(validProject, func(io.Reader, io.Writer, []string) (string, error) {
			if err := os.Setenv("HOME", ""); err != nil {
				t.Fatal(err)
			}
			return testDocsScope, nil
		})
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "caching selected") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestSetCommandRejectsArguments(t *testing.T) {
	cmd := newRootCmd()
	cmd.SetArgs([]string{"set", "genai-project", "extra"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected argument error")
	}
}

func newSetGenAIZMSServer(t *testing.T) *httptest.Server {
	return newSetGenAIZMSServerWithOptionalDocs(t, true)
}

func newSetGenAIZMSServerWithOptionalDocs(t *testing.T, includeDocs bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/zms/v1/role" && r.URL.Query().Get("principal") == "user.alice":
			roles := []map[string]string{{"domainName": "gen-ai.services.athenz", "roleName": testBaselineRole}}
			if includeDocs {
				roles = append(roles, map[string]string{"domainName": "gen-ai.services.athenz", "roleName": testDocsScope})
			}
			json.NewEncoder(w).Encode(map[string]any{"memberRoles": roles})
		case r.URL.Path == "/zms/v1/role" && r.URL.Query().Get("principal") == "home.alice.local.athenzd":
			roles := []map[string]string{{"domainName": "gen-ai.services.athenz", "roleName": testBaselineRole + "-jag-exchanger"}}
			if includeDocs {
				roles = append(roles, map[string]string{"domainName": "gen-ai.services.athenz", "roleName": "docs-reader-jag-exchanger"})
			}
			json.NewEncoder(w).Encode(map[string]any{"memberRoles": roles})
		case r.URL.Path == "/zms/v1/domain/gen-ai.services.athenz/member":
			json.NewEncoder(w).Encode(map[string]any{"members": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
}

func newSetGenAIZTSServer(t *testing.T, denyAccessToken bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/zts/v1/.well-known/openid-configuration":
			fmt.Fprint(w, `{"issuer":"https://issuer.example.test"}`)
		case "/zts/v1/oauth2/token":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			scope := r.Form.Get("scope")
			if r.Form.Get("assertion") != "" && denyAccessToken {
				http.Error(w, "denied", http.StatusForbidden)
				return
			}
			token := fakeIDToken(`{"sub":"user.alice","scope":"` + scope + `"}`)
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": token,
				"token_type":   "Bearer",
				"expires_in":   3600,
				"scope":        scope,
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeSetConfig(t *testing.T, zmsURL, ztsURL, certFile, keyFile, currentService, serviceTemplate string, genAI bool) string {
	t.Helper()
	genAIConfig := ""
	if genAI {
		genAIConfig = "gen_ai:\n  domain: gen-ai.services.{{project}}\n  role: gen-ai-users\n"
	}
	return writeTemp(t, fmt.Sprintf(`athenz:
  zts: %s
  zms: %s
current_service: %s
%sservices:
  - name: profile
    athenz:
      service: %s
    idp:
      issuer: https://idp.example.test
      client_id: athenzd
    identity:
      cert_file: %s
      key_file: %s
`, ztsURL, zmsURL, currentService, genAIConfig, serviceTemplate, certFile, keyFile))
}

func cacheSetIDToken(t *testing.T, service, token string, expiresAt time.Time) {
	t.Helper()
	if err := cache.Save(service, cache.TokenEntry{IDToken: token, ExpiresAt: expiresAt}); err != nil {
		t.Fatal(err)
	}
}
