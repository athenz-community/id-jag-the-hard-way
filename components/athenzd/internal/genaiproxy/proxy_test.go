package genaiproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestHandlerForwardsAndReloadsAccessToken(t *testing.T) {
	var authorizations []string
	var expectedHost string
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorizations = append(authorizations, request.Header.Get("Authorization"))
		if request.Method != http.MethodPost || request.URL.RequestURI() != "/api/chat?stream=true" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.RequestURI())
		}
		if request.Host != expectedHost {
			t.Fatalf("unexpected host: %s", request.Host)
		}
		if request.Header.Get("Via") != "1.1 athenzd-genai-proxy" {
			t.Fatalf("missing request Via header")
		}
		body, _ := io.ReadAll(request.Body)
		response.Header().Set("Content-Type", "application/x-ndjson")
		response.WriteHeader(http.StatusCreated)
		_, _ = response.Write(body)
	}))
	defer upstream.Close()
	expectedHost = strings.TrimPrefix(upstream.URL, "http://")

	token := "first-at"
	handler, err := newHandler(upstream.URL, "project-instance", func() (*AccessToken, error) {
		return &AccessToken{Token: token, ExpiresAt: time.Unix(200, 0)}, nil
	}, func() time.Time { return time.Unix(100, 0) })
	if err != nil {
		t.Fatal(err)
	}

	for _, expected := range []string{"first-at", "second-at"} {
		token = expected
		request := httptest.NewRequest(http.MethodPost, "http://local/api/chat?stream=true", strings.NewReader(`{"model":"gemma"}`))
		request.Header.Set("Authorization", "Bearer caller-supplied-value")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusCreated || response.Body.String() != `{"model":"gemma"}` {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
		if !strings.Contains(response.Header().Get("Via"), "athenzd-genai-proxy") {
			t.Fatalf("missing response Via header: %q", response.Header().Get("Via"))
		}
	}
	if strings.Join(authorizations, ",") != "Bearer first-at,Bearer second-at" {
		t.Fatalf("unexpected authorizations: %v", authorizations)
	}
}

func TestHandlerHealthDoesNotLoadToken(t *testing.T) {
	loads := 0
	handler, err := NewHandler("http://127.0.0.1:64443", func() (*AccessToken, error) {
		loads++
		return nil, errors.New("must not run")
	})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://local/healthz", nil))
	if response.Code != http.StatusOK || loads != 0 || !strings.Contains(response.Body.String(), "athenzd-genai-proxy") {
		t.Fatalf("status=%d loads=%d body=%q", response.Code, loads, response.Body.String())
	}
}

func TestHandlerRejectsUnavailableTokens(t *testing.T) {
	now := time.Unix(100, 0)
	tests := []struct {
		name   string
		source TokenSource
		status int
		code   string
	}{
		{"load error", func() (*AccessToken, error) { return nil, errors.New("cache failed") }, http.StatusServiceUnavailable, "access_token_unavailable"},
		{"nil", func() (*AccessToken, error) { return nil, nil }, http.StatusUnauthorized, "access_token_missing"},
		{"empty", func() (*AccessToken, error) { return &AccessToken{}, nil }, http.StatusUnauthorized, "access_token_missing"},
		{"expired", func() (*AccessToken, error) { return &AccessToken{Token: "at", ExpiresAt: now}, nil }, http.StatusUnauthorized, "access_token_expired"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, err := newHandler("http://127.0.0.1:64443", "", test.source, func() time.Time { return now })
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://local/api/tags", nil))
			var body map[string]string
			_ = json.Unmarshal(response.Body.Bytes(), &body)
			if response.Code != test.status || body["error"] != test.code {
				t.Fatalf("status=%d body=%v", response.Code, body)
			}
		})
	}
}

func TestHandlerRejectsInvalidSetup(t *testing.T) {
	for _, upstream := range []string{"%", "file:///tmp/ollama", "http:///missing-host"} {
		if _, err := NewHandler(upstream, func() (*AccessToken, error) { return nil, nil }); err == nil {
			t.Fatalf("expected invalid upstream error for %q", upstream)
		}
	}
	if _, err := NewHandler("http://localhost:64443", nil); err == nil {
		t.Fatal("expected token source error")
	}
}

func TestHandlerRedactsUpstreamFailure(t *testing.T) {
	handler, err := NewHandler("http://127.0.0.1:1", func() (*AccessToken, error) {
		return &AccessToken{Token: "secret-at", ExpiresAt: time.Now().Add(time.Hour)}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://local/api/tags", nil))
	if response.Code != http.StatusBadGateway || strings.Contains(response.Body.String(), "secret-at") {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestRunStopsWithContextAndReportsBindErrors(t *testing.T) {
	if err := Run(context.Background(), Options{UpstreamURL: "%"}); err == nil {
		t.Fatal("expected invalid upstream error")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var output bytes.Buffer
	err := Run(ctx, Options{
		Port:        0,
		UpstreamURL: "http://127.0.0.1:64443",
		TokenSource: func() (*AccessToken, error) { return nil, nil },
		Output:      &output,
	})
	if err != nil || !strings.Contains(output.String(), "athenzd GenAI proxy listening") {
		t.Fatalf("err=%v output=%q", err, output.String())
	}
	if err := Run(ctx, Options{
		Port:        0,
		UpstreamURL: "http://127.0.0.1:64443",
		TokenSource: func() (*AccessToken, error) { return nil, nil },
	}); err != nil {
		t.Fatalf("canceled run without output: %v", err)
	}

	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_, portValue, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portValue)
	err = Run(context.Background(), Options{
		Port:        port,
		UpstreamURL: "http://127.0.0.1:64443",
		TokenSource: func() (*AccessToken, error) { return nil, nil },
	})
	if err == nil || !strings.Contains(err.Error(), "listening") {
		t.Fatalf("expected bind error, got %v", err)
	}

	originalListen := listenTCP
	t.Cleanup(func() { listenTCP = originalListen })
	listenTCP = func(string, string) (net.Listener, error) { return errorListener{}, nil }
	err = Run(context.Background(), Options{
		Port:        65443,
		UpstreamURL: "http://127.0.0.1:64443",
		TokenSource: func() (*AccessToken, error) { return nil, nil },
	})
	if err == nil || !strings.Contains(err.Error(), "serving") {
		t.Fatalf("expected serve error, got %v", err)
	}
}

type errorListener struct{}

func (errorListener) Accept() (net.Conn, error) { return nil, errors.New("accept failed") }
func (errorListener) Close() error              { return nil }
func (errorListener) Addr() net.Addr            { return testAddr("127.0.0.1:65443") }

type testAddr string

func (address testAddr) Network() string { return "tcp" }
func (address testAddr) String() string  { return string(address) }
