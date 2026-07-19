package zms

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/genai"
)

const (
	testGenAIDomain = "gen-ai.services.{{project}}"
	testGenAIRole   = "gen-ai-users"
)

func TestDiscoverGenAIScopesMultipleServices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testToken {
			t.Errorf("unexpected authorization header")
		}
		domain := r.URL.Query().Get("domain")
		principal := r.URL.Query().Get("principal")
		switch {
		case r.URL.Path == "/zms/v1/role" && r.URL.Query().Get("expand") == "true" && principal == "user.alice" && domain == "":
			fmt.Fprint(w, `{"memberRoles":[
				{"domainName":"gen-ai.services.athenz","roleName":"gen-ai.services.athenz:role.gen-ai-users"},
				{"domainName":"gen-ai.services.athenz","roleName":"docs-reader"},
				{"domainName":"gen-ai.services.mail","roleName":"gen-ai-users"},
				{"domainName":"gen-ai.services.mail","roleName":"gen-ai.services.mail:role.writer"},
				{"domainName":"gen-ai.services.calendar","roleName":"reader"},
				{"domainName":"other.services.chat","roleName":"gen-ai-users"},
				{"domainName":"gen-ai.services.wrong","roleName":"gen-ai.services.mail:role.gen-ai-users"},
				{"domainName":"","roleName":"not-qualified"},
				{"domainName":"gen-ai.services.bad.name","roleName":"gen-ai-users"}
			]}`)
		case r.URL.Path == "/zms/v1/role" && r.URL.Query().Get("expand") == "true" && principal == "home.alice.local.athenzd" && domain == "gen-ai.services.athenz":
			fmt.Fprint(w, `{"memberRoles":[
				{"domainName":"gen-ai.services.athenz","roleName":"docs-reader-jag-exchanger"},
				{"domainName":"gen-ai.services.athenz","roleName":"admin"},
				{"domainName":"gen-ai.services.athenz","roleName":"unused-jag-exchanger"},
				{"domainName":"gen-ai.services.mail","roleName":"writer-jag-exchanger"}
			]}`)
		case r.URL.Path == "/zms/v1/domain/gen-ai.services.athenz/member":
			fmt.Fprint(w, `{"members":[
				{"memberName":"home.*","memberRoles":[{"roleName":"gen-ai.services.athenz:role.gen-ai-users-jag-exchanger"}]},
				{"memberName":"other.*","memberRoles":[{"roleName":"unused-jag-exchanger"}]},
				{"memberName":"home.alice.local.athenzd","memberRoles":[{"roleName":"ignored-exact-jag-exchanger"}]}
			]}`)
		case r.URL.Path == "/zms/v1/role" && r.URL.Query().Get("expand") == "true" && principal == "home.alice.local.athenzd" && domain == "gen-ai.services.mail":
			fmt.Fprint(w, `{"memberRoles":[
				{"roleName":"gen-ai.services.mail:role.writer-jag-exchanger"},
				{"roleName":"bad-role"}
			]}`)
		case r.URL.Path == "/zms/v1/domain/gen-ai.services.mail/member":
			fmt.Fprint(w, `{"members":[
				{"memberName":"home.alice*","memberRoles":[{"roleName":"gen-ai-users-jag-exchanger"}]},
				{"memberName":"home.bob*","memberRoles":[{"roleName":"writer-jag-exchanger"}]}
			]}`)
		default:
			t.Errorf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL+"/zms/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	projects, err := client.DiscoverGenAIScopes(context.Background(), testToken,
		"user.alice", "home.alice.local.athenzd", testGenAIDomain, " "+testGenAIRole+" ")
	if err != nil {
		t.Fatal(err)
	}
	want := []genai.ServiceScopes{
		{Service: "athenz", Domain: "gen-ai.services.athenz", Scopes: []string{
			"gen-ai.services.athenz:role.docs-reader",
			"gen-ai.services.athenz:role.gen-ai-users",
		}},
		{Service: "mail", Domain: "gen-ai.services.mail", Scopes: []string{
			"gen-ai.services.mail:role.gen-ai-users",
			"gen-ai.services.mail:role.writer",
		}},
	}
	if !reflect.DeepEqual(projects, want) {
		t.Fatalf("projects=%v want=%v", projects, want)
	}
}

func TestDiscoverGenAIScopesValidation(t *testing.T) {
	client, _ := NewClientWithHTTPClient("https://zms.example.test/zms/v1", http.DefaultClient)
	for _, test := range []struct {
		name     string
		token    string
		user     string
		workload string
		domain   string
		role     string
		want     string
	}{
		{"token", " ", "user.alice", "home.alice.local.athenzd", testGenAIDomain, testGenAIRole, "ID token"},
		{"user", testToken, "bad/principal", "home.alice.local.athenzd", testGenAIDomain, testGenAIRole, "user principal"},
		{"workload", testToken, "user.alice", "bad/principal", testGenAIDomain, testGenAIRole, "workload principal"},
		{"domain", testToken, "user.alice", "home.alice.local.athenzd", "gen-ai.services", testGenAIRole, "GenAI domain"},
		{"role", testToken, "user.alice", "home.alice.local.athenzd", testGenAIDomain, "bad+role", "GenAI role"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := client.DiscoverGenAIScopes(context.Background(), test.token, test.user, test.workload, test.domain, test.role)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
}

func TestDiscoverGenAIScopesUserLookupResults(t *testing.T) {
	for _, test := range []struct {
		name  string
		step  transportStep
		want  string
		empty bool
	}{
		{"transport", transportStep{err: fmt.Errorf("transport failed")}, "listing GenAI roles", false},
		{"not found", transportStep{status: http.StatusNotFound}, "", true},
		{"forbidden", transportStep{status: http.StatusForbidden, body: "denied"}, "listing GenAI roles", false},
		{"bad response", transportStep{status: http.StatusOK, body: "{"}, "decoding GenAI roles", false},
		{"no baseline", transportStep{status: http.StatusOK, body: `{"memberRoles":[{"domainName":"gen-ai.services.mail","roleName":"reader"}]}`}, "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.step)
			projects, err := client.DiscoverGenAIScopes(context.Background(), testToken,
				"user.alice", "home.alice.local.athenzd", testGenAIDomain, testGenAIRole)
			if test.want != "" {
				if err == nil || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("expected %q, got %v", test.want, err)
				}
			} else if err != nil || len(projects) != 0 {
				t.Fatalf("projects=%v err=%v", projects, err)
			}
			script.assertComplete()
		})
	}
}

func TestDiscoverGenAIScopesExchangerLookupResults(t *testing.T) {
	userRoles := transportStep{status: http.StatusOK, body: `{"memberRoles":[
		{"domainName":"gen-ai.services.athenz","roleName":"gen-ai-users"},
		{"domainName":"gen-ai.services.mail","roleName":"gen-ai-users"}
	]}`}
	for _, test := range []struct {
		name  string
		steps []transportStep
		want  string
	}{
		{"transport", []transportStep{userRoles, {err: fmt.Errorf("transport failed")}}, "listing exchanger roles"},
		{"not found then no baseline", []transportStep{userRoles,
			{status: http.StatusNotFound}, {status: http.StatusOK, body: `{"members":[]}`},
			{status: http.StatusOK, body: `{"memberRoles":[]}`}, {status: http.StatusOK, body: `{"members":[]}`}}, ""},
		{"forbidden", []transportStep{userRoles, {status: http.StatusForbidden, body: "denied"}}, "listing exchanger roles"},
		{"bad response", []transportStep{userRoles, {status: http.StatusOK, body: "{"}}, "decoding exchanger roles"},
		{"wildcard transport", []transportStep{userRoles, {status: http.StatusOK, body: `{"memberRoles":[]}`}, {err: fmt.Errorf("transport failed")}}, "listing wildcard exchanger roles"},
		{"wildcard forbidden", []transportStep{userRoles, {status: http.StatusOK, body: `{"memberRoles":[]}`}, {status: http.StatusForbidden, body: "denied"}}, "listing wildcard exchanger roles"},
		{"wildcard bad response", []transportStep{userRoles, {status: http.StatusOK, body: `{"memberRoles":[]}`}, {status: http.StatusOK, body: "{"}}, "decoding wildcard exchanger roles"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.steps...)
			projects, err := client.DiscoverGenAIScopes(context.Background(), testToken,
				"user.alice", "home.alice.local.athenzd", testGenAIDomain, testGenAIRole)
			if test.want != "" {
				if err == nil || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("expected %q, got %v", test.want, err)
				}
			} else if err != nil || len(projects) != 0 {
				t.Fatalf("projects=%v err=%v", projects, err)
			}
			script.assertComplete()
		})
	}
}

func TestWildcardMemberMatches(t *testing.T) {
	principal := "home.alice.local.athenzd"
	for _, test := range []struct {
		member string
		want   bool
	}{
		{"*", true},
		{"home.*", true},
		{"home.alice.local.athenz*", true},
		{"home.bob*", false},
		{"home.*.athenzd", false},
		{principal, false},
	} {
		if got := wildcardMemberMatches(test.member, principal); got != test.want {
			t.Errorf("wildcardMemberMatches(%q, %q)=%t want %t", test.member, principal, got, test.want)
		}
	}
}
