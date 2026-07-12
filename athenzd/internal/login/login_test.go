package login_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/login"
)

// mockOIDCServer starts a minimal OIDC server that returns a fake id_token.
// It captures the code_challenge so it can complete the PKCE exchange.
func mockOIDCServer(t *testing.T) *httptest.Server {
	t.Helper()
	var capturedRedirect string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/protocol/openid-connect/auth":
			// Redirect straight to the callback with a fake code.
			capturedRedirect = r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, capturedRedirect+"?code=fake-code&state="+state, http.StatusFound)

		case "/protocol/openid-connect/token":
			// Return a fake token response with an id_token.
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fake-access-token",
				"id_token":     "fake-id-token",
				"token_type":   "Bearer",
				"expiry":       time.Now().Add(1 * time.Hour).Unix(),
			})
		}
	}))

	t.Cleanup(srv.Close)
	return srv
}

// TestRun_Success checks that a successful PKCE flow returns an ID token.
func TestRun_Success(t *testing.T) {
	oidc := mockOIDCServer(t)

	cfg := login.Config{
		Issuer:       oidc.URL,
		ClientID:     "test-client",
		CallbackPort: 0, // random port
	}

	var capturedURL string
	openBrowser := func(url string) error {
		capturedURL = url
		// Simulate the browser hitting the callback by following the auth redirect.
		resp, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	}

	result, err := login.Run(context.Background(), cfg, openBrowser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IDToken != "fake-id-token" {
		t.Errorf("unexpected ID token: %q", result.IDToken)
	}
	if !strings.Contains(capturedURL, "code_challenge") {
		t.Errorf("expected PKCE code_challenge in auth URL, got: %q", capturedURL)
	}
}

// TestRun_StateMismatch checks that a state mismatch in the callback returns an error.
func TestRun_StateMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/protocol/openid-connect/auth" {
			redirect := r.URL.Query().Get("redirect_uri")
			// Return wrong state — simulates CSRF.
			http.Redirect(w, r, redirect+"?code=fake-code&state=wrong-state", http.StatusFound)
		}
	}))
	defer srv.Close()

	cfg := login.Config{
		Issuer:       srv.URL,
		ClientID:     "test-client",
		CallbackPort: 0,
	}

	openBrowser := func(url string) error {
		go http.Get(url) //nolint:noctx,errcheck
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := login.Run(ctx, cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for state mismatch, got nil")
	}
}

// TestRun_AuthError checks that an error response from the IdP is surfaced.
func TestRun_AuthError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/protocol/openid-connect/auth" {
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r,
				fmt.Sprintf("%s?error=access_denied&error_description=denied&state=%s", redirect, state),
				http.StatusFound)
		}
	}))
	defer srv.Close()

	cfg := login.Config{Issuer: srv.URL, ClientID: "test-client", CallbackPort: 0}
	openBrowser := func(url string) error {
		go http.Get(url) //nolint:noctx,errcheck
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := login.Run(ctx, cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for auth error, got nil")
	}
}

// TestRun_ContextCancelled checks that cancelling the context aborts the login.
func TestRun_ContextCancelled(t *testing.T) {
	cfg := login.Config{
		Issuer:       "http://localhost:19999", // nothing listening
		ClientID:     "test-client",
		CallbackPort: 0,
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	openBrowser := func(url string) error { return nil }

	_, err := login.Run(ctx, cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
}

// TestRun_MissingCode checks that a callback with no code returns an error.
func TestRun_MissingCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/protocol/openid-connect/auth" {
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			// Redirect with state but no code.
			http.Redirect(w, r, redirect+"?state="+state, http.StatusFound)
		}
	}))
	defer srv.Close()

	cfg := login.Config{Issuer: srv.URL, ClientID: "test-client", CallbackPort: 0}
	openBrowser := func(url string) error {
		go http.Get(url) //nolint:noctx,errcheck
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := login.Run(ctx, cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for missing code, got nil")
	}
}

// TestRun_MissingIDToken checks that a token response without id_token returns an error.
func TestRun_MissingIDToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/protocol/openid-connect/auth":
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
		case "/protocol/openid-connect/token":
			// Return a token response with no id_token field.
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fake-access-token",
				"token_type":   "Bearer",
			})
		}
	}))
	defer srv.Close()

	cfg := login.Config{Issuer: srv.URL, ClientID: "test-client", CallbackPort: 0}
	openBrowser := func(url string) error {
		resp, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	}

	_, err := login.Run(context.Background(), cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for missing id_token, got nil")
	}
}

// TestRun_TokenExchangeFail checks that a failed token exchange returns an error.
func TestRun_TokenExchangeFail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/protocol/openid-connect/auth":
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
		case "/protocol/openid-connect/token":
			// Return an error from the token endpoint.
			http.Error(w, "server error", http.StatusInternalServerError)
		}
	}))
	defer srv.Close()

	cfg := login.Config{Issuer: srv.URL, ClientID: "test-client", CallbackPort: 0}
	openBrowser := func(url string) error {
		resp, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	}

	_, err := login.Run(context.Background(), cfg, openBrowser)
	if err == nil {
		t.Fatal("expected error for token exchange failure, got nil")
	}
}

// TestRun_PortConflict checks that a port already in use returns an error.
func TestRun_PortConflict(t *testing.T) {
	// Bind a listener to grab a port, then try to start the callback server on the same port.
	ln, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	cfg := login.Config{
		Issuer:       "http://localhost:19999",
		ClientID:     "test-client",
		CallbackPort: port,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err = login.Run(ctx, cfg, func(url string) error { return nil })
	if err == nil {
		t.Fatal("expected error for port conflict, got nil")
	}
}
