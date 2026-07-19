package idjag

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/zts"
)

const (
	testSubject           = "header.payload.signature"
	testUserPrincipal     = "user.alice"
	testWorkloadPrincipal = "home.alice.local.athenzd"
)

type fakeDiscoverer struct {
	projects []genai.ServiceScopes
	err      error
}

func (f fakeDiscoverer) DiscoverGenAIScopes(_ context.Context, token, userPrincipal, workloadPrincipal, template, role string) ([]genai.ServiceScopes, error) {
	if token != testSubject || userPrincipal != testUserPrincipal || workloadPrincipal != testWorkloadPrincipal ||
		template != "gen-ai.services.{{service}}" || role != "gen-ai-users" {
		return nil, fmt.Errorf("unexpected discovery request")
	}
	return f.projects, f.err
}

type fakeExchanger struct {
	failedScope string
}

func (f fakeExchanger) ExchangeIDJAG(_ context.Context, subjectToken, scope string) (*zts.IDJAG, error) {
	if subjectToken != testSubject {
		return nil, fmt.Errorf("unexpected subject")
	}
	if scope == f.failedScope {
		return nil, fmt.Errorf("exchange denied")
	}
	return &zts.IDJAG{AccessToken: "token-for-" + scope, Scope: scope, ExpiresIn: 600}, nil
}

func testRequest() Request {
	return Request{SubjectToken: testSubject, UserPrincipal: testUserPrincipal, WorkloadPrincipal: testWorkloadPrincipal,
		DomainTemplate: "gen-ai.services.{{service}}", BaselineRole: "gen-ai-users"}
}

func TestIssuerMultipleProjects(t *testing.T) {
	projects := []genai.ServiceScopes{
		{Service: "athenz", Domain: "gen-ai.services.athenz", Scopes: []string{"athenz:role.reader", "athenz:role.writer"}},
		{Service: "mail", Domain: "gen-ai.services.mail", Scopes: []string{"mail:role.reader"}},
	}
	issuer := NewIssuer(fakeDiscoverer{projects: projects}, func() (TokenExchanger, error) {
		return fakeExchanger{}, nil
	})
	results, err := issuer.Issue(context.Background(), testRequest())
	if err != nil {
		t.Fatal(err)
	}
	want := []Result{
		{Service: "athenz", Domain: "gen-ai.services.athenz", Token: "token-for-athenz:role.reader athenz:role.writer", Scope: "athenz:role.reader athenz:role.writer", ExpiresIn: 600},
		{Service: "mail", Domain: "gen-ai.services.mail", Token: "token-for-mail:role.reader", Scope: "mail:role.reader", ExpiresIn: 600},
	}
	if !reflect.DeepEqual(results, want) {
		t.Fatalf("results=%+v want=%+v", results, want)
	}
}

func TestIssuerErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		discoverer fakeDiscoverer
		factory    ExchangerFactory
		want       string
	}{
		{"discovery", fakeDiscoverer{err: fmt.Errorf("lookup failed")}, func() (TokenExchanger, error) { return fakeExchanger{}, nil }, "discovering GenAI roles"},
		{"no project", fakeDiscoverer{}, func() (TokenExchanger, error) { return fakeExchanger{}, nil }, "no GenAI service project"},
		{"factory", fakeDiscoverer{projects: []genai.ServiceScopes{{Service: "athenz"}}}, func() (TokenExchanger, error) { return nil, fmt.Errorf("loading identity") }, "loading identity"},
		{"exchange", fakeDiscoverer{projects: []genai.ServiceScopes{{Service: "mail", Domain: "gen-ai.services.mail", Scopes: []string{"mail:role.reader"}}}}, func() (TokenExchanger, error) { return fakeExchanger{failedScope: "mail:role.reader"}, nil }, "issuing ID-JAG for GenAI service mail"},
	} {
		t.Run(test.name, func(t *testing.T) {
			issuer := NewIssuer(test.discoverer, test.factory)
			_, err := issuer.Issue(context.Background(), testRequest())
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
}
