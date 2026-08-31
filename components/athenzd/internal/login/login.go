package login

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"golang.org/x/oauth2"
)

type Config struct {
	Issuer       string // e.g. https://localhost:34444/realms/master
	ClientID     string
	CallbackPort int // local port for the PKCE redirect (e.g. 8250)
	// CAFile trusts a custom CA for the IdP HTTPS connection. Empty = system trust.
	CAFile string
}

type Result struct {
	IDToken   string
	ExpiresAt time.Time
}

// Run opens the browser for PKCE login and waits for the callback.
// Returns the ID token and its expiry.
func Run(ctx context.Context, cfg Config, openBrowser func(url string) error) (*Result, error) {
	// If a custom CA is configured, build an HTTP client that trusts it and
	// hand it to the oauth2 library via the context. This lets the token
	// exchange reach an HTTPS IdP whose cert is signed by a private CA.
	if cfg.CAFile != "" {
		client, err := httpClientWithCA(cfg.CAFile)
		if err != nil {
			return nil, err
		}
		ctx = context.WithValue(ctx, oauth2.HTTPClient, client)
	}

	oauth2Cfg := &oauth2.Config{
		ClientID:    cfg.ClientID,
		RedirectURL: fmt.Sprintf("http://localhost:%d/callback", cfg.CallbackPort),
		Scopes:      []string{"openid"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  cfg.Issuer + "/protocol/openid-connect/auth",
			TokenURL: cfg.Issuer + "/protocol/openid-connect/token",
		},
	}

	verifier, challenge, state, err := pkceParams()
	if err != nil {
		return nil, fmt.Errorf("generating PKCE params: %w", err)
	}

	authURL := oauth2Cfg.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)

	srv, port, err := startCallbackServer(cfg.CallbackPort, state, codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("starting callback server on port %d: %w", cfg.CallbackPort, err)
	}
	defer srv.Shutdown(ctx) //nolint:errcheck

	// If port was 0 (random), update the redirect URL with the actual port.
	if cfg.CallbackPort == 0 {
		oauth2Cfg.RedirectURL = fmt.Sprintf("http://localhost:%d/callback", port)
		authURL = oauth2Cfg.AuthCodeURL(state,
			oauth2.S256ChallengeOption(verifier),
			oauth2.SetAuthURLParam("code_challenge", challenge),
			oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		)
	}

	fmt.Printf("Opening browser for login...\nIf it doesn't open, visit:\n  %s\n\n", authURL)
	_ = openBrowser(authURL)

	select {
	case code := <-codeCh:
		token, err := oauth2Cfg.Exchange(ctx, code, oauth2.VerifierOption(verifier))
		if err != nil {
			return nil, fmt.Errorf("exchanging code: %w", err)
		}
		idToken, ok := token.Extra("id_token").(string)
		if !ok || idToken == "" {
			return nil, fmt.Errorf("id_token missing from token response")
		}
		return &Result{IDToken: idToken, ExpiresAt: token.Expiry}, nil
	case err := <-errCh:
		return nil, err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// startCallbackServer starts a local HTTP server to receive the PKCE redirect.
// Returns the server, the actual port it bound to, and any startup error.
func startCallbackServer(port int, expectedState string, codeCh chan<- string, errCh chan<- error) (*http.Server, int, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", port))
	if err != nil {
		return nil, 0, err
	}
	actualPort := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("state") != expectedState {
			errCh <- fmt.Errorf("state mismatch: possible CSRF")
			http.Error(w, "state mismatch", http.StatusBadRequest)
			return
		}
		if e := q.Get("error"); e != "" {
			errCh <- fmt.Errorf("auth error: %s — %s", e, q.Get("error_description"))
			http.Error(w, e, http.StatusBadRequest)
			return
		}
		code := q.Get("code")
		if code == "" {
			errCh <- fmt.Errorf("missing code in callback")
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}
		fmt.Fprintln(w, "Login successful — you can close this tab.")
		codeCh <- code
	})

	srv := &http.Server{Handler: mux}
	go srv.Serve(ln) //nolint:errcheck
	return srv, actualPort, nil
}

// httpClientWithCA returns an HTTP client that trusts the CA cert at caFile
// in addition to nothing else (the IdP connection uses only this CA).
func httpClientWithCA(caFile string) (*http.Client, error) {
	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("reading idp ca_file: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("no valid certificates in idp ca_file %q", caFile)
	}
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		},
	}, nil
}

// pkceParams generates a PKCE verifier, challenge, and state.
func pkceParams() (verifier, challenge, state string, err error) {
	verifier = oauth2.GenerateVerifier()
	challenge = oauth2.S256ChallengeFromVerifier(verifier)
	b := make([]byte, 16)
	if _, err = rand.Read(b); err != nil {
		return "", "", "", err
	}
	state = base64.RawURLEncoding.EncodeToString(b)
	return verifier, challenge, state, nil
}
