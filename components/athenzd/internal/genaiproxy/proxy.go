package genaiproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

const listenHost = "0.0.0.0"

var listenTCP = net.Listen

type AccessToken struct {
	Token     string
	ExpiresAt time.Time
}

type TokenSource func() (*AccessToken, error)

type Options struct {
	Port        int
	UpstreamURL string
	InstanceID  string
	TokenSource TokenSource
	Output      io.Writer
}

// Run starts the local credential-injecting proxy and blocks until its context
// is cancelled or the HTTP server fails.
func Run(ctx context.Context, options Options) error {
	handler, err := newHandler(options.UpstreamURL, options.InstanceID, options.TokenSource, time.Now)
	if err != nil {
		return err
	}
	listener, err := listenTCP("tcp4", fmt.Sprintf("%s:%d", listenHost, options.Port))
	if err != nil {
		return fmt.Errorf("listening for athenzd GenAI proxy on port %d: %w", options.Port, err)
	}
	output := options.Output
	if output == nil {
		output = io.Discard
	}
	fmt.Fprintf(output, "✓ athenzd GenAI proxy listening on http://%s\n", listener.Addr())
	fmt.Fprintf(output, "  Forwarding to %s with the active cached GenAI access token\n", options.UpstreamURL)
	fmt.Fprintln(output, "  Managed by the athenzd CLI.")

	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = server.Close()
		case <-done:
		}
	}()
	serveErr := server.Serve(listener)
	close(done)
	if errors.Is(serveErr, http.ErrServerClosed) && ctx.Err() != nil {
		return nil
	}
	return fmt.Errorf("serving athenzd GenAI proxy: %w", serveErr)
}

func NewHandler(upstreamURL string, tokenSource TokenSource) (http.Handler, error) {
	return newHandler(upstreamURL, "", tokenSource, time.Now)
}

func newHandler(upstreamURL, instanceID string, tokenSource TokenSource, now func() time.Time) (http.Handler, error) {
	upstream, err := url.Parse(upstreamURL)
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") || upstream.Host == "" {
		return nil, fmt.Errorf("invalid GenAI proxy upstream URL %q", upstreamURL)
	}
	if tokenSource == nil {
		return nil, fmt.Errorf("GenAI access-token source is required")
	}

	reverseProxy := httputil.NewSingleHostReverseProxy(upstream)
	director := reverseProxy.Director
	reverseProxy.Director = func(request *http.Request) {
		director(request)
		request.Host = upstream.Host
		request.Header.Set("Via", "1.1 athenzd-genai-proxy")
	}
	reverseProxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Add("Via", "1.1 athenzd-genai-proxy")
		return nil
	}
	reverseProxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, _ error) {
		sendJSON(response, http.StatusBadGateway, map[string]string{
			"error":   "genai_upstream_unavailable",
			"message": "The configured GenAI proxy could not be reached.",
		})
	}

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/healthz" {
			sendJSON(response, http.StatusOK, map[string]string{
				"instance": instanceID,
				"service":  "athenzd-genai-proxy",
				"status":   "ok",
				"upstream": upstreamURL,
			})
			return
		}

		accessToken, err := tokenSource()
		if err != nil {
			sendJSON(response, http.StatusServiceUnavailable, map[string]string{
				"error":   "access_token_unavailable",
				"message": "The active GenAI access token could not be loaded; run `athenzd login`.",
			})
			return
		}
		if accessToken == nil || accessToken.Token == "" {
			sendJSON(response, http.StatusUnauthorized, map[string]string{
				"error":   "access_token_missing",
				"message": "No active GenAI access token is cached; run `athenzd login`.",
			})
			return
		}
		if !accessToken.ExpiresAt.After(now()) {
			sendJSON(response, http.StatusUnauthorized, map[string]string{
				"error":   "access_token_expired",
				"message": "The active GenAI access token expired; run `athenzd set genai-project` or `athenzd login`.",
			})
			return
		}

		request.Header.Set("Authorization", "Bearer "+accessToken.Token)
		reverseProxy.ServeHTTP(response, request)
	}), nil
}

func sendJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}
