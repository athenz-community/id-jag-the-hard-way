package zts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExchangeIDJAGForAccessToken(t *testing.T) {
	token := fakeIDJAGJWT(t, map[string]any{"sub": "user.alice", "scp": []string{testDocsScope}})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/zts/v1/oauth2/token" {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		want := map[string]string{
			"grant_type": idJAGAssertionGrantType,
			"assertion":  "id-jag-token",
			"scope":      testDocsScope,
			"expires_in": defaultATExpiresIn,
		}
		for key, value := range want {
			if r.Form.Get(key) != value {
				t.Errorf("%s=%q want=%q", key, r.Form.Get(key), value)
			}
		}
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   3600,
			"scope":        testDocsScope,
		})
	}))
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL+"/zts/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	accessToken, err := client.ExchangeIDJAGForAccessToken(context.Background(), "id-jag-token", testDocsScope)
	if err != nil {
		t.Fatal(err)
	}
	if accessToken.Token != token || accessToken.Scope != testDocsScope || accessToken.TokenType != "Bearer" || accessToken.ExpiresIn != 3600 {
		t.Fatalf("unexpected access token: %+v", accessToken)
	}
}

func TestExchangeIDJAGForAccessTokenAcceptsAthenzRoleOnlyScope(t *testing.T) {
	const grantedScope = "gen-ai-users"
	token := fakeIDJAGJWT(t, map[string]any{"sub": "user.alice", "scp": []string{grantedScope}})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   3600,
			"scope":        grantedScope,
		})
	}))
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	accessToken, err := client.ExchangeIDJAGForAccessToken(context.Background(), "id-jag-token", testGenAIScope)
	if err != nil {
		t.Fatal(err)
	}
	if accessToken.Scope != testGenAIScope {
		t.Fatalf("scope=%q want=%q", accessToken.Scope, testGenAIScope)
	}
}

func TestExchangeIDJAGForAccessTokenErrors(t *testing.T) {
	client, _ := NewClientWithHTTPClient("https://zts.example.test/zts/v1", http.DefaultClient)
	for _, test := range []struct {
		assertion string
		scope     string
		want      string
	}{
		{"", testDocsScope, "assertion"},
		{"id-jag", "", "exactly one"},
		{"id-jag", testDocsScope + " " + testGenAIScope, "exactly one"},
	} {
		if _, err := client.ExchangeIDJAGForAccessToken(context.Background(), test.assertion, test.scope); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("expected %q, got %v", test.want, err)
		}
	}

	tests := []struct {
		name     string
		status   int
		response string
		want     string
	}{
		{"status", http.StatusForbidden, `{"message":"not authorized"}`, "not authorized"},
		{"status plain", http.StatusBadRequest, `plain failure`, "plain failure"},
		{"bad json", http.StatusOK, `{`, "decoding ZTS access-token response"},
		{"missing token", http.StatusOK, `{}`, "did not contain access_token"},
		{"bad jwt", http.StatusOK, `{"access_token":"bad"}`, "decoding issued access token"},
		{"missing scope", http.StatusOK, tokenResponseJSON(t, map[string]any{"sub": "user.alice"}, testDocsScope), "did not contain scp or scope"},
		{"wrong jwt scope", http.StatusOK, tokenResponseJSON(t, map[string]any{"scope": testGenAIScope}, testDocsScope), "do not exactly match"},
		{"extra jwt scope", http.StatusOK, tokenResponseJSON(t, map[string]any{"scope": testDocsScope + " " + testGenAIScope}, testDocsScope), "do not exactly match"},
		{"wrong response scope", http.StatusOK, tokenResponseJSON(t, map[string]any{"scope": testDocsScope}, testGenAIScope), "response scope"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.response)
			}))
			defer server.Close()
			client, _ := NewClientWithHTTPClient(server.URL, server.Client())
			_, err := client.ExchangeIDJAGForAccessToken(context.Background(), "id-jag", testDocsScope)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
}

func TestAccessTokenTransportAndReadErrors(t *testing.T) {
	client := &Client{baseURL: "https://zts.example.test", httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("exchange transport")
	})}}
	if _, err := client.ExchangeIDJAGForAccessToken(context.Background(), "id-jag", testDocsScope); err == nil || !strings.Contains(err.Error(), "exchanging ID-JAG") {
		t.Fatalf("unexpected transport error: %v", err)
	}
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(errorReader{})}, nil
	})
	if _, err := client.ExchangeIDJAGForAccessToken(context.Background(), "id-jag", testDocsScope); err == nil || !strings.Contains(err.Error(), "reading ZTS access-token") {
		t.Fatalf("unexpected read error: %v", err)
	}
	if !strings.Contains((&AccessTokenExchangeError{StatusCode: 500}).Error(), "HTTP 500") ||
		!strings.Contains((&AccessTokenExchangeError{StatusCode: 400, Message: "bad"}).Error(), "bad") {
		t.Fatal("access-token exchange error formatting mismatch")
	}
}

func TestMatchesAccessTokenScope(t *testing.T) {
	for _, test := range []struct {
		granted   []string
		requested string
		want      bool
	}{
		{[]string{testGenAIScope}, testGenAIScope, true},
		{[]string{"gen-ai-users"}, testGenAIScope, true},
		{nil, testGenAIScope, false},
		{[]string{"one", "two"}, testGenAIScope, false},
		{[]string{"other"}, testGenAIScope, false},
		{[]string{"gen-ai-users"}, "gen-ai-users", true},
		{[]string{""}, "gen-ai.services.athenz:role.", false},
	} {
		if got := matchesAccessTokenScope(test.granted, test.requested); got != test.want {
			t.Fatalf("matchesAccessTokenScope(%q, %q)=%v want=%v", test.granted, test.requested, got, test.want)
		}
	}
}
