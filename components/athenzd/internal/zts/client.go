// Package zts implements the Copper Argos instance-registration operation
// used by athenzd after an interactive OIDC login.
package zts

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	maxResponseBytes = 1 << 20
	requestTimeout   = 30 * time.Second
	privateKeyBits   = 2048
)

var instanceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)
var enrollmentKeyAndCSR = generateKeyAndCSR

// EnrollRequest contains the attested identity and local output paths for one
// ZTS instance-registration request.
type EnrollRequest struct {
	Provider        string
	Domain          string
	Service         string
	InstanceID      string
	AttestationData string
	ExpiryMinutes   int
	CertFile        string
	KeyFile         string
	CAFile          string
}

// Identity is the validated identity returned by ZTS.
type Identity struct {
	Provider              string            `json:"provider"`
	Name                  string            `json:"name"`
	InstanceID            string            `json:"instanceId"`
	X509Certificate       string            `json:"x509Certificate"`
	X509CertificateSigner string            `json:"x509CertificateSigner"`
	Attributes            map[string]string `json:"attributes,omitempty"`
}

// RegistrationError reports a non-201 response from the ZTS instance endpoint.
// Callers can inspect StatusCode to distinguish temporary policy-cache lag from
// permanent request failures.
type RegistrationError struct {
	StatusCode int
	Message    string
}

func (e *RegistrationError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("ZTS instance registration failed with HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("ZTS instance registration failed with HTTP %d: %s", e.StatusCode, e.Message)
}

// Client calls the unauthenticated ZTS instance-registration endpoint. The ID
// token is sent as attestationData, not as an HTTP authorization credential.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a ZTS client. caFile is optional and is used only to trust
// the ZTS HTTPS endpoint; it is separate from the signer CA output file.
func NewClient(baseURL, caFile string) (*Client, error) {
	httpClient, err := newHTTPClient(caFile)
	if err != nil {
		return nil, err
	}
	return NewClientWithHTTPClient(baseURL, httpClient)
}

// NewClientWithHTTPClient supports callers and tests that already own the HTTP
// transport policy.
func NewClientWithHTTPClient(baseURL string, httpClient *http.Client) (*Client, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid ZTS URL %q", baseURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("invalid ZTS URL scheme %q", parsed.Scheme)
	}
	if httpClient == nil {
		return nil, fmt.Errorf("ZTS HTTP client is required")
	}
	return &Client{baseURL: parsed.String(), httpClient: httpClient}, nil
}

func newHTTPClient(caFile string) (*http.Client, error) {
	if caFile == "" {
		return &http.Client{Timeout: requestTimeout}, nil
	}
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("reading Athenz ca_file: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("no valid certificates in Athenz ca_file %q", caFile)
	}
	return &http.Client{
		Timeout: requestTimeout,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{
			RootCAs:    pool,
			MinVersion: tls.VersionTLS12,
		}},
	}, nil
}

// Enroll generates a new private key and Athenz-compatible CSR, sends the
// cached ID token as workload attestation, validates the returned certificate,
// and only then writes the credential files.
func (c *Client) Enroll(ctx context.Context, request EnrollRequest) (*Identity, error) {
	if err := validateRequest(request); err != nil {
		return nil, err
	}

	privateKey, csr, err := enrollmentKeyAndCSR(request)
	if err != nil {
		return nil, err
	}

	payload := struct {
		Provider        string `json:"provider"`
		Domain          string `json:"domain"`
		Service         string `json:"service"`
		AttestationData string `json:"attestationData"`
		CSR             string `json:"csr"`
		ExpiryTime      *int   `json:"expiryTime,omitempty"`
	}{
		Provider:        request.Provider,
		Domain:          request.Domain,
		Service:         request.Service,
		AttestationData: request.AttestationData,
		CSR:             csr,
	}
	if request.ExpiryMinutes > 0 {
		payload.ExpiryTime = &request.ExpiryMinutes
	}
	body, _ := json.Marshal(payload)

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/instance", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating ZTS instance registration request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("registering instance with ZTS: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("reading ZTS instance registration response: %w", err)
	}
	if response.StatusCode != http.StatusCreated {
		return nil, unexpectedStatus(response.StatusCode, responseBody)
	}

	var identity Identity
	if err := json.Unmarshal(responseBody, &identity); err != nil {
		return nil, fmt.Errorf("decoding ZTS instance identity: %w", err)
	}
	if err := validateIdentity(&identity, request, privateKey); err != nil {
		return nil, err
	}

	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	if err := writeCredentials(request, keyPEM, []byte(identity.X509Certificate), []byte(identity.X509CertificateSigner)); err != nil {
		return nil, err
	}
	return &identity, nil
}

func validateRequest(request EnrollRequest) error {
	values := []struct {
		name  string
		value string
	}{
		{"provider", request.Provider},
		{"domain", request.Domain},
		{"service", request.Service},
		{"attestation data", request.AttestationData},
		{"certificate file", request.CertFile},
		{"private key file", request.KeyFile},
		{"signer CA file", request.CAFile},
	}
	for _, value := range values {
		if strings.TrimSpace(value.value) == "" {
			return fmt.Errorf("%s is required for ZTS instance registration", value.name)
		}
	}
	if !instanceIDPattern.MatchString(request.InstanceID) {
		return fmt.Errorf("instance id %q must contain only letters, digits, dot, underscore, colon, or hyphen", request.InstanceID)
	}
	if request.ExpiryMinutes < 0 {
		return fmt.Errorf("certificate expiry minutes must not be negative")
	}

	paths := map[string]string{}
	for name, configuredPath := range map[string]string{
		"certificate file": request.CertFile,
		"private key file": request.KeyFile,
		"signer CA file":   request.CAFile,
	} {
		expanded, err := expandPath(configuredPath)
		if err != nil {
			return fmt.Errorf("resolving %s: %w", name, err)
		}
		if previous, exists := paths[expanded]; exists {
			return fmt.Errorf("%s and %s must use different paths", previous, name)
		}
		paths[expanded] = name
	}
	return nil
}

func generateKeyAndCSR(request EnrollRequest) (*rsa.PrivateKey, string, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, privateKeyBits)
	if err != nil {
		return nil, "", fmt.Errorf("generating RSA private key: %w", err)
	}

	spiffeURI := &url.URL{Scheme: "spiffe", Host: request.Domain, Path: "/sa/" + request.Service}
	instanceURI := &url.URL{Scheme: "athenz", Host: "instanceid", Path: "/" + request.Provider + "/" + request.InstanceID}

	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: request.Domain + "." + request.Service},
		SignatureAlgorithm: x509.SHA256WithRSA,
		// Athenz's SIA clients put the service SPIFFE URI first and the
		// provider-scoped instance ID second.
		URIs: []*url.URL{spiffeURI, instanceURI},
	}, privateKey)
	if err != nil {
		return nil, "", fmt.Errorf("creating certificate signing request: %w", err)
	}
	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})
	return privateKey, string(csrPEM), nil
}

func validateIdentity(identity *Identity, request EnrollRequest, privateKey *rsa.PrivateKey) error {
	expectedName := request.Domain + "." + request.Service
	if identity.Provider != request.Provider {
		return fmt.Errorf("ZTS returned provider %q, expected %q", identity.Provider, request.Provider)
	}
	if identity.Name != expectedName {
		return fmt.Errorf("ZTS returned identity %q, expected %q", identity.Name, expectedName)
	}
	if identity.InstanceID != request.InstanceID {
		return fmt.Errorf("ZTS returned instance id %q, expected %q", identity.InstanceID, request.InstanceID)
	}

	certificate, err := parseFirstCertificate(identity.X509Certificate, "service certificate")
	if err != nil {
		return err
	}
	if certificate.Subject.CommonName != expectedName {
		return fmt.Errorf("ZTS certificate common name %q does not match %q", certificate.Subject.CommonName, expectedName)
	}
	publicKey, ok := certificate.PublicKey.(*rsa.PublicKey)
	if !ok || !publicKey.Equal(&privateKey.PublicKey) {
		return fmt.Errorf("ZTS certificate public key does not match the generated private key")
	}
	signer, err := parseFirstCertificate(identity.X509CertificateSigner, "certificate signer")
	if err != nil {
		return err
	}
	roots := x509.NewCertPool()
	roots.AddCert(signer)
	if _, err := certificate.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		return fmt.Errorf("verifying ZTS service certificate with returned signer: %w", err)
	}
	return nil
}

func parseFirstCertificate(value, label string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(value))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("ZTS returned an invalid PEM %s", label)
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing ZTS %s: %w", label, err)
	}
	return certificate, nil
}

func writeCredentials(request EnrollRequest, keyPEM, certPEM, caPEM []byte) error {
	files := []struct {
		label string
		path  string
		data  []byte
		mode  os.FileMode
	}{
		{"private key", request.KeyFile, keyPEM, 0600},
		{"service certificate", request.CertFile, certPEM, 0644},
		{"signer CA", request.CAFile, caPEM, 0644},
	}
	for _, file := range files {
		path, err := expandPath(file.path)
		if err != nil {
			return fmt.Errorf("resolving %s output path: %w", file.label, err)
		}
		if err := writeFile(path, file.data, file.mode); err != nil {
			return fmt.Errorf("writing %s: %w", file.label, err)
		}
	}
	return nil
}

func writeFile(path string, data []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".athenzd-credential-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func expandPath(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~/")), nil
	}
	if strings.HasPrefix(path, "~") {
		return "", fmt.Errorf("only ~ and ~/ paths are supported")
	}
	return filepath.Clean(path), nil
}

func unexpectedStatus(status int, body []byte) error {
	var resourceError struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &resourceError) == nil && strings.TrimSpace(resourceError.Message) != "" {
		return &RegistrationError{StatusCode: status, Message: resourceError.Message}
	}
	message := strings.TrimSpace(string(body))
	return &RegistrationError{StatusCode: status, Message: message}
}
