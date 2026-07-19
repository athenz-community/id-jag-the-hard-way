package zms

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewClientRejectsUnreadableCA(t *testing.T) {
	_, err := NewClient("https://zms.example.test/zms/v1", filepath.Join(t.TempDir(), "missing.pem"))
	if err == nil || !strings.Contains(err.Error(), "reading Athenz ca_file") {
		t.Fatalf("expected CA read error, got %v", err)
	}
}

func TestEnsurePropagatesStageErrors(t *testing.T) {
	tests := []struct {
		name  string
		steps []transportStep
		want  string
	}{
		{
			name:  "parent request",
			steps: []transportStep{{err: errors.New("parent transport")}},
			want:  "checking required personal home domain",
		},
		{
			name:  "parent status",
			steps: []transportStep{{status: http.StatusInternalServerError, body: "parent failed"}},
			want:  "parent failed",
		},
		{
			name: "subdomain",
			steps: []transportStep{
				{status: http.StatusOK},
				{status: http.StatusInternalServerError},
			},
			want: "checking local subdomain",
		},
		{
			name: "administrator",
			steps: []transportStep{
				{status: http.StatusOK},
				{status: http.StatusOK},
				{status: http.StatusInternalServerError},
			},
			want: "checking local subdomain administrators",
		},
		{
			name: "service",
			steps: []transportStep{
				{status: http.StatusOK},
				{status: http.StatusOK},
				{status: http.StatusOK, body: `{"roleMembers":[{"memberName":"user.athenz_admin"}]}`},
				{status: http.StatusInternalServerError},
			},
			want: "checking athenzd service",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.steps...)
			_, err := client.Ensure(context.Background(), testToken, mustTarget(t), []string{testOptionalAdmin})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
			script.assertComplete()
		})
	}
}

func TestEnsureSubdomainErrors(t *testing.T) {
	tests := []struct {
		name  string
		steps []transportStep
		want  string
	}{
		{"lookup request", []transportStep{{err: errors.New("lookup transport")}}, "checking local subdomain"},
		{"lookup status", []transportStep{{status: http.StatusForbidden}}, "HTTP 403"},
		{"create request", []transportStep{{status: http.StatusNotFound}, {err: errors.New("create transport")}}, "creating local subdomain"},
		{"create status", []transportStep{{status: http.StatusNotFound}, {status: http.StatusBadRequest, body: "bad create"}}, "bad create"},
		{"verify request", []transportStep{{status: http.StatusNotFound}, {status: http.StatusConflict}, {err: errors.New("verify transport")}}, "verifying local subdomain"},
		{"verify status", []transportStep{{status: http.StatusNotFound}, {status: http.StatusConflict}, {status: http.StatusNotFound, body: "still absent"}}, "still absent"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.steps...)
			target := mustTarget(t)
			_, err := client.ensureSubdomain(context.Background(), testToken, target, []string{target.UserPrincipal, testOptionalAdmin})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
			script.assertComplete()
		})
	}
}

func TestEnsureSubdomainHandlesCreationConflict(t *testing.T) {
	client, script := newScriptedClient(t,
		transportStep{status: http.StatusNotFound},
		transportStep{status: http.StatusConflict},
		transportStep{status: http.StatusOK},
	)
	target := mustTarget(t)
	created, err := client.ensureSubdomain(context.Background(), testToken, target, []string{target.UserPrincipal, testOptionalAdmin})
	if err != nil || created {
		t.Fatalf("expected verified conflict to be unchanged, created=%v err=%v", created, err)
	}
	script.assertComplete()
}

func TestEnsureAdminErrors(t *testing.T) {
	emptyRole := `{"roleMembers":[]}`
	tests := []struct {
		name  string
		steps []transportStep
		want  string
	}{
		{"lookup request", []transportStep{{err: errors.New("lookup transport")}}, "checking local subdomain administrators"},
		{"lookup status", []transportStep{{status: http.StatusForbidden}}, "HTTP 403"},
		{"lookup body", []transportStep{{status: http.StatusOK, body: "not-json"}}, "decoding admin role response"},
		{"update request", []transportStep{{status: http.StatusOK, body: emptyRole}, {err: errors.New("update transport")}}, "adding optional administrator"},
		{"update status", []transportStep{{status: http.StatusOK, body: emptyRole}, {status: http.StatusBadRequest, body: "bad update"}}, "bad update"},
		{"verify request", []transportStep{{status: http.StatusOK, body: emptyRole}, {status: http.StatusNoContent}, {err: errors.New("verify transport")}}, "verifying optional administrator"},
		{"verify status", []transportStep{{status: http.StatusOK, body: emptyRole}, {status: http.StatusNoContent}, {status: http.StatusNotFound}}, "HTTP 404"},
		{"verify body", []transportStep{{status: http.StatusOK, body: emptyRole}, {status: http.StatusNoContent}, {status: http.StatusOK, body: "not-json"}}, "decoding admin role response"},
		{"verify absent", []transportStep{{status: http.StatusOK, body: emptyRole}, {status: http.StatusNoContent}, {status: http.StatusOK, body: emptyRole}}, "was not present after update"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.steps...)
			_, err := client.ensureAdmin(context.Background(), testToken, mustTarget(t), testOptionalAdmin)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
			script.assertComplete()
		})
	}
}

func TestEnsureServiceErrors(t *testing.T) {
	tests := []struct {
		name  string
		steps []transportStep
		want  string
	}{
		{"lookup request", []transportStep{{err: errors.New("lookup transport")}}, "checking athenzd service"},
		{"lookup status", []transportStep{{status: http.StatusForbidden}}, "HTTP 403"},
		{"create request", []transportStep{{status: http.StatusNotFound}, {err: errors.New("create transport")}}, "creating athenzd service"},
		{"create status", []transportStep{{status: http.StatusNotFound}, {status: http.StatusBadRequest, body: "bad create"}}, "bad create"},
		{"verify request", []transportStep{{status: http.StatusNotFound}, {status: http.StatusNoContent}, {err: errors.New("verify transport")}}, "verifying athenzd service"},
		{"verify status", []transportStep{{status: http.StatusNotFound}, {status: http.StatusNoContent}, {status: http.StatusNotFound, body: "still absent"}}, "still absent"},
		{"verify body", []transportStep{{status: http.StatusNotFound}, {status: http.StatusNoContent}, {status: http.StatusOK, body: `{"name":"wrong"}`}}, "ZMS returned service"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, script := newScriptedClient(t, test.steps...)
			_, err := client.ensureService(context.Background(), testToken, mustTarget(t))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
			script.assertComplete()
		})
	}
}

func TestRequestReturnsReadError(t *testing.T) {
	client, script := newScriptedClient(t, transportStep{status: http.StatusOK, readErr: errors.New("read failed")})
	_, _, err := client.request(context.Background(), testToken, http.MethodGet, "/domain/example", nil)
	if err == nil || !strings.Contains(err.Error(), "read failed") {
		t.Fatalf("expected response read error, got %v", err)
	}
	script.assertComplete()
}

type transportStep struct {
	status  int
	body    string
	err     error
	readErr error
}

type scriptedTransport struct {
	t     *testing.T
	steps []transportStep
	next  int
}

func newScriptedClient(t *testing.T, steps ...transportStep) (*Client, *scriptedTransport) {
	t.Helper()
	script := &scriptedTransport{t: t, steps: steps}
	client, err := NewClientWithHTTPClient("https://zms.example.test/zms/v1", &http.Client{Transport: script})
	if err != nil {
		t.Fatal(err)
	}
	return client, script
}

func (s *scriptedTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	s.t.Helper()
	if s.next >= len(s.steps) {
		s.t.Fatalf("unexpected request %s %s", request.Method, request.URL)
	}
	step := s.steps[s.next]
	s.next++
	if request.Header.Get("Authorization") != "Bearer "+testToken {
		s.t.Errorf("unexpected Authorization header: %q", request.Header.Get("Authorization"))
	}
	if step.err != nil {
		return nil, step.err
	}
	body := io.ReadCloser(io.NopCloser(strings.NewReader(step.body)))
	if step.readErr != nil {
		body = &errorReadCloser{err: step.readErr}
	}
	return &http.Response{
		StatusCode: step.status,
		Header:     make(http.Header),
		Body:       body,
		Request:    request,
	}, nil
}

func (s *scriptedTransport) assertComplete() {
	s.t.Helper()
	if s.next != len(s.steps) {
		s.t.Fatalf("used %d of %d scripted requests", s.next, len(s.steps))
	}
}

type errorReadCloser struct {
	err error
}

func (r *errorReadCloser) Read([]byte) (int, error) {
	return 0, r.err
}

func (r *errorReadCloser) Close() error {
	return nil
}
