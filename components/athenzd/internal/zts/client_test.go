package zts

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEnrollSuccess(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	caKey, caCertificate, caPEM := newTestCA(t)
	server := newRegistrationServer(t, caKey, caCertificate, caPEM, func(payload registrationPayload, csr *x509.CertificateRequest) {
		if payload.Provider != "sys.auth.localworkload" || payload.Domain != "home.idjag-learner.local" ||
			payload.Service != "athenzd" || payload.AttestationData != "header.payload.signature" {
			t.Errorf("unexpected registration payload: %+v", payload)
		}
		if payload.ExpiryTime == nil || *payload.ExpiryTime != 60 {
			t.Errorf("unexpected expiry: %v", payload.ExpiryTime)
		}
		if csr.Subject.CommonName != "home.idjag-learner.local.athenzd" {
			t.Errorf("unexpected CSR common name: %q", csr.Subject.CommonName)
		}
		if len(csr.URIs) != 2 || csr.URIs[0].String() != "spiffe://home.idjag-learner.local/sa/athenzd" ||
			csr.URIs[1].String() != "athenz://instanceid/sys.auth.localworkload/workstation-idjag-learner" {
			t.Errorf("unexpected CSR URIs: %v", csr.URIs)
		}
	})
	defer server.Close()

	client, err := NewClientWithHTTPClient(server.URL+"/zts/v1/", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	request := validRequest()
	request.CertFile = "~/.config/athenzd/identity/service.cert.pem"
	request.KeyFile = "~/.config/athenzd/identity/service.key.pem"
	request.CAFile = "~/.config/athenzd/identity/ca.cert.pem"
	request.ExpiryMinutes = 60

	identity, err := client.Enroll(context.Background(), request)
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if identity.Name != "home.idjag-learner.local.athenzd" || identity.InstanceID != request.InstanceID {
		t.Fatalf("unexpected identity: %+v", identity)
	}

	keyPath := filepath.Join(home, ".config/athenzd/identity/service.key.pem")
	certPath := filepath.Join(home, ".config/athenzd/identity/service.cert.pem")
	caPath := filepath.Join(home, ".config/athenzd/identity/ca.cert.pem")
	keyInfo, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if keyInfo.Mode().Perm() != 0600 {
		t.Errorf("private key mode = %o", keyInfo.Mode().Perm())
	}
	for _, publicPath := range []string{certPath, caPath} {
		info, err := os.Stat(publicPath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0644 {
			t.Errorf("%s mode = %o", publicPath, info.Mode().Perm())
		}
	}

	keyBlock, _ := pem.Decode(mustRead(t, keyPath))
	privateKey, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	certBlock, _ := pem.Decode(mustRead(t, certPath))
	certificate, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if !certificate.PublicKey.(*rsa.PublicKey).Equal(&privateKey.PublicKey) {
		t.Fatal("written certificate and private key do not match")
	}
	if string(mustRead(t, caPath)) != string(caPEM) {
		t.Fatal("unexpected signer CA output")
	}
}

func TestEnrollOmitsZeroExpiry(t *testing.T) {
	caKey, caCertificate, caPEM := newTestCA(t)
	server := newRegistrationServer(t, caKey, caCertificate, caPEM, func(payload registrationPayload, _ *x509.CertificateRequest) {
		if payload.ExpiryTime != nil {
			t.Errorf("expected omitted expiry, got %v", *payload.ExpiryTime)
		}
	})
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	request := validRequest()
	setOutputDir(&request, t.TempDir())
	if _, err := client.Enroll(context.Background(), request); err != nil {
		t.Fatal(err)
	}
}

func TestEnrollRequestValidation(t *testing.T) {
	client, err := NewClientWithHTTPClient("https://zts.example.test/zts/v1", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(*EnrollRequest)
		want   string
	}{
		{"provider", func(r *EnrollRequest) { r.Provider = " " }, "provider is required"},
		{"domain", func(r *EnrollRequest) { r.Domain = "" }, "domain is required"},
		{"service", func(r *EnrollRequest) { r.Service = "" }, "service is required"},
		{"attestation", func(r *EnrollRequest) { r.AttestationData = "" }, "attestation data is required"},
		{"cert file", func(r *EnrollRequest) { r.CertFile = "" }, "certificate file is required"},
		{"key file", func(r *EnrollRequest) { r.KeyFile = "" }, "private key file is required"},
		{"ca file", func(r *EnrollRequest) { r.CAFile = "" }, "signer CA file is required"},
		{"instance", func(r *EnrollRequest) { r.InstanceID = "bad/id" }, "instance id"},
		{"expiry", func(r *EnrollRequest) { r.ExpiryMinutes = -1 }, "must not be negative"},
		{"duplicate", func(r *EnrollRequest) { r.KeyFile = r.CertFile }, "must use different paths"},
		{"unsupported home", func(r *EnrollRequest) { r.CertFile = "~somebody/cert.pem" }, "only ~ and ~/ paths"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validRequest()
			test.mutate(&request)
			_, err := client.Enroll(context.Background(), request)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestClientValidationAndCustomCA(t *testing.T) {
	for _, baseURL := range []string{"", "://bad", "ftp://zts.example.test"} {
		if _, err := NewClientWithHTTPClient(baseURL, http.DefaultClient); err == nil {
			t.Fatalf("expected invalid URL error for %q", baseURL)
		}
	}
	if _, err := NewClientWithHTTPClient("https://zts.example.test", nil); err == nil {
		t.Fatal("expected nil client error")
	}
	if client, err := newHTTPClient(""); err != nil || client.Timeout != requestTimeout {
		t.Fatalf("default client: client=%v err=%v", client, err)
	}
	if _, err := newHTTPClient(filepath.Join(t.TempDir(), "missing.pem")); err == nil {
		t.Fatal("expected missing CA error")
	}
	if _, err := NewClient("https://zts.example.test", filepath.Join(t.TempDir(), "missing.pem")); err == nil {
		t.Fatal("expected NewClient CA error")
	}
	badCA := filepath.Join(t.TempDir(), "bad.pem")
	if err := os.WriteFile(badCA, []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newHTTPClient(badCA); err == nil {
		t.Fatal("expected invalid CA error")
	}

	tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ok") }))
	defer tlsServer.Close()
	caPath := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: tlsServer.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(tlsServer.URL, caPath)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.httpClient.Get(tlsServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
}

func TestEnrollResponseErrors(t *testing.T) {
	requestFor := func(t *testing.T) EnrollRequest {
		r := validRequest()
		setOutputDir(&r, t.TempDir())
		return r
	}
	tests := []struct {
		name    string
		handler http.HandlerFunc
		want    string
	}{
		{"status", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"message":"attestation rejected"}`)
		}, "attestation rejected"},
		{"malformed json", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
			fmt.Fprint(w, `{`)
		}, "decoding ZTS instance identity"},
		{"invalid identity", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
			fmt.Fprint(w, `{}`)
		}, "ZTS returned provider"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			client, _ := NewClientWithHTTPClient(server.URL, server.Client())
			_, err := client.Enroll(context.Background(), requestFor(t))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}

	client, _ := NewClientWithHTTPClient("http://127.0.0.1:1", http.DefaultClient)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.Enroll(ctx, requestFor(t)); err == nil || !strings.Contains(err.Error(), "registering instance") {
		t.Fatalf("expected request error, got %v", err)
	}

	brokenClient := &Client{baseURL: ":", httpClient: http.DefaultClient}
	if _, err := brokenClient.Enroll(context.Background(), requestFor(t)); err == nil || !strings.Contains(err.Error(), "creating ZTS instance registration request") {
		t.Fatalf("expected request construction error, got %v", err)
	}

	readClient := &Client{
		baseURL: "https://zts.example.test",
		httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(errorReader{})}, nil
		})},
	}
	if _, err := readClient.Enroll(context.Background(), requestFor(t)); err == nil || !strings.Contains(err.Error(), "reading ZTS instance registration response") {
		t.Fatalf("expected response read error, got %v", err)
	}
}

func TestEnrollGenerationAndWriteErrors(t *testing.T) {
	original := enrollmentKeyAndCSR
	enrollmentKeyAndCSR = func(EnrollRequest) (*rsa.PrivateKey, string, error) {
		return nil, "", fmt.Errorf("injected generation error")
	}
	t.Cleanup(func() { enrollmentKeyAndCSR = original })
	client, _ := NewClientWithHTTPClient("https://zts.example.test", http.DefaultClient)
	if _, err := client.Enroll(context.Background(), validRequest()); err == nil || !strings.Contains(err.Error(), "injected generation error") {
		t.Fatalf("expected generation error, got %v", err)
	}
	enrollmentKeyAndCSR = original

	caKey, caCertificate, caPEM := newTestCA(t)
	server := newRegistrationServer(t, caKey, caCertificate, caPEM, nil)
	defer server.Close()
	client, _ = NewClientWithHTTPClient(server.URL, server.Client())
	request := validRequest()
	blockingPath := filepath.Join(t.TempDir(), "block")
	if err := os.WriteFile(blockingPath, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	request.KeyFile = filepath.Join(blockingPath, "key.pem")
	request.CertFile = filepath.Join(t.TempDir(), "cert.pem")
	request.CAFile = filepath.Join(t.TempDir(), "ca.pem")
	if _, err := client.Enroll(context.Background(), request); err == nil || !strings.Contains(err.Error(), "writing private key") {
		t.Fatalf("expected credential write error, got %v", err)
	}
}

func TestValidateIdentityErrors(t *testing.T) {
	request := validRequest()
	privateKey, _, err := generateKeyAndCSR(request)
	if err != nil {
		t.Fatal(err)
	}
	caKey, caCertificate, caPEM := newTestCA(t)
	certPEM := certificateForPublicKey(t, caKey, caCertificate, &privateKey.PublicKey, request.Domain+"."+request.Service)
	valid := Identity{
		Provider:              request.Provider,
		Name:                  request.Domain + "." + request.Service,
		InstanceID:            request.InstanceID,
		X509Certificate:       string(certPEM),
		X509CertificateSigner: string(caPEM),
	}
	tests := []struct {
		name   string
		mutate func(*Identity)
		want   string
	}{
		{"provider", func(i *Identity) { i.Provider = "other.provider" }, "returned provider"},
		{"name", func(i *Identity) { i.Name = "other.service" }, "returned identity"},
		{"instance", func(i *Identity) { i.InstanceID = "other" }, "returned instance id"},
		{"certificate pem", func(i *Identity) { i.X509Certificate = "bad" }, "invalid PEM service certificate"},
		{"certificate der", func(i *Identity) {
			i.X509Certificate = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte("bad")}))
		}, "parsing ZTS service certificate"},
		{"common name", func(i *Identity) {
			i.X509Certificate = string(certificateForPublicKey(t, caKey, caCertificate, &privateKey.PublicKey, "wrong"))
		}, "common name"},
		{"public key", func(i *Identity) {
			wrong, _ := rsa.GenerateKey(rand.Reader, 2048)
			i.X509Certificate = string(certificateForPublicKey(t, caKey, caCertificate, &wrong.PublicKey, request.Domain+"."+request.Service))
		}, "does not match"},
		{"signer", func(i *Identity) { i.X509CertificateSigner = "bad" }, "invalid PEM certificate signer"},
		{"signer mismatch", func(i *Identity) {
			_, _, otherCAPEM := newTestCA(t)
			i.X509CertificateSigner = string(otherCAPEM)
		}, "verifying ZTS service certificate with returned signer"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			identity := valid
			test.mutate(&identity)
			if err := validateIdentity(&identity, request, privateKey); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestWriteHelpersAndStatus(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "file")
	if err := writeFile(path, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if string(mustRead(t, path)) != "secret" {
		t.Fatal("unexpected file content")
	}
	blockingPath := filepath.Join(t.TempDir(), "block")
	if err := os.WriteFile(blockingPath, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(blockingPath, "file"), []byte("x"), 0600); err == nil {
		t.Fatal("expected output directory error")
	}
	if got, err := expandPath("relative/file"); err != nil || got != filepath.Clean("relative/file") {
		t.Fatalf("relative path: got=%q err=%v", got, err)
	}
	t.Setenv("HOME", t.TempDir())
	if got, err := expandPath("~"); err != nil || got != os.Getenv("HOME") {
		t.Fatalf("home path: got=%q err=%v", got, err)
	}
	request := validRequest()
	request.KeyFile = "~somebody/key.pem"
	if err := writeCredentials(request, []byte("key"), []byte("cert"), []byte("ca")); err == nil || !strings.Contains(err.Error(), "resolving private key") {
		t.Fatalf("expected credential path error, got %v", err)
	}
	request = validRequest()
	request.KeyFile = filepath.Join(blockingPath, "key.pem")
	if err := writeCredentials(request, []byte("key"), []byte("cert"), []byte("ca")); err == nil || !strings.Contains(err.Error(), "writing private key") {
		t.Fatalf("expected credential write error, got %v", err)
	}
	if !strings.Contains(unexpectedStatus(500, nil).Error(), "HTTP 500") ||
		!strings.Contains(unexpectedStatus(400, []byte(" plain error ")).Error(), "plain error") {
		t.Fatal("unexpected status formatting")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) {
	return 0, errors.New("injected read error")
}

type registrationPayload struct {
	Provider        string `json:"provider"`
	Domain          string `json:"domain"`
	Service         string `json:"service"`
	AttestationData string `json:"attestationData"`
	CSR             string `json:"csr"`
	ExpiryTime      *int   `json:"expiryTime"`
}

func newRegistrationServer(t *testing.T, caKey *rsa.PrivateKey, caCertificate *x509.Certificate, caPEM []byte, inspect func(registrationPayload, *x509.CertificateRequest)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/instance") {
			http.NotFound(w, r)
			return
		}
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			t.Errorf("ID token leaked into HTTP Authorization header: %q", authorization)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected content type: %q", r.Header.Get("Content-Type"))
		}
		var payload registrationPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		block, _ := pem.Decode([]byte(payload.CSR))
		if block == nil {
			t.Fatal("missing CSR PEM")
		}
		csr, err := x509.ParseCertificateRequest(block.Bytes)
		if err != nil || csr.CheckSignature() != nil {
			t.Fatalf("invalid CSR: %v", err)
		}
		if inspect != nil {
			inspect(payload, csr)
		}
		certPEM := certificateForPublicKey(t, caKey, caCertificate, csr.PublicKey, payload.Domain+"."+payload.Service)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Identity{
			Provider:              payload.Provider,
			Name:                  payload.Domain + "." + payload.Service,
			InstanceID:            "workstation-idjag-learner",
			X509Certificate:       string(certPEM),
			X509CertificateSigner: string(caPEM),
			Attributes:            map[string]string{"certUsage": "client"},
		})
	}))
}

func newTestCA(t *testing.T) (*rsa.PrivateKey, *x509.Certificate, []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test Athenz CA"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return key, certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func certificateForPublicKey(t *testing.T, caKey *rsa.PrivateKey, caCertificate *x509.Certificate, publicKey any, commonName string) []byte {
	t.Helper()
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: commonName},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, caCertificate, publicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func validRequest() EnrollRequest {
	return EnrollRequest{
		Provider:        "sys.auth.localworkload",
		Domain:          "home.idjag-learner.local",
		Service:         "athenzd",
		InstanceID:      "workstation-idjag-learner",
		AttestationData: "header.payload.signature",
		CertFile:        "service.cert.pem",
		KeyFile:         "service.key.pem",
		CAFile:          "ca.cert.pem",
	}
}

func setOutputDir(request *EnrollRequest, directory string) {
	request.CertFile = filepath.Join(directory, "service.cert.pem")
	request.KeyFile = filepath.Join(directory, "service.key.pem")
	request.CAFile = filepath.Join(directory, "ca.cert.pem")
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	value, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
