package accesstoken

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/zts"
)

type fakeExchanger struct {
	assertion string
	scope     string
	err       error
}

func (f *fakeExchanger) ExchangeIDJAGForAccessToken(_ context.Context, assertion, scope string) (*zts.AccessToken, error) {
	f.assertion = assertion
	f.scope = scope
	if f.err != nil {
		return nil, f.err
	}
	return &zts.AccessToken{Token: "access-token", Scope: scope, TokenType: "Bearer", ExpiresIn: 3600}, nil
}

func TestIssue(t *testing.T) {
	exchanger := &fakeExchanger{}
	result, err := Issue(context.Background(), exchanger, "id-jag", "gen-ai.services.docs:role.reader")
	if err != nil {
		t.Fatal(err)
	}
	if exchanger.assertion != "id-jag" || exchanger.scope != "gen-ai.services.docs:role.reader" {
		t.Fatalf("unexpected exchange request: %+v", exchanger)
	}
	if result.Token != "access-token" || result.Scope != exchanger.scope || result.TokenType != "Bearer" || result.ExpiresIn != 3600 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestIssueError(t *testing.T) {
	_, err := Issue(context.Background(), &fakeExchanger{err: fmt.Errorf("denied")}, "id-jag", "gen-ai.services.docs:role.reader")
	if err == nil || !strings.Contains(err.Error(), "issuing access token") || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("unexpected error: %v", err)
	}
}
