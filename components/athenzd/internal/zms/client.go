// Package zms contains the small part of the ZMS API that athenzd needs after
// an interactive login. It deliberately does not own the login or token cache:
// callers pass the freshly issued ID token as the request credential.
package zms

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"text/template"
	"time"
)

const (
	PreferredUsernameTemplate = "{{.preferred_username}}"
	DefaultServiceTemplate    = "home.{{.preferred_username}}.local.athenzd"
	maxResponseBytes          = 1 << 20
)

var simpleNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`)
var memberNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_][a-zA-Z0-9_-]*)+$`)

// Target is the Athenz hierarchy derived from the configured service profile
// and the preferred_username claim in the freshly issued ID token.
type Target struct {
	PreferredUsername string
	UserPrincipal     string
	ParentDomain      string
	SubdomainName     string
	Domain            string
	ServiceName       string
	ServiceIdentity   string
}

// ResolveTarget renders a full Athenz service identity from a standard Go
// template (the same template family used by kubectl), then separates the
// parent domain, child domain, and simple service name needed by ZMS.
func ResolveTarget(serviceTemplate, preferredUsername string) (Target, error) {
	username := strings.TrimSpace(preferredUsername)
	if !simpleNamePattern.MatchString(username) {
		return Target{}, fmt.Errorf("preferred_username %q is not a valid Athenz simple name", preferredUsername)
	}

	serviceTemplateValue, err := template.New("athenz-service").Option("missingkey=error").Parse(serviceTemplate)
	if err != nil {
		return Target{}, fmt.Errorf("parsing athenz.service Go template: %w", err)
	}
	var rendered bytes.Buffer
	if err := serviceTemplateValue.Execute(&rendered, map[string]string{
		"preferred_username": username,
	}); err != nil {
		return Target{}, fmt.Errorf("rendering athenz.service Go template: %w", err)
	}
	serviceIdentity := rendered.String()
	serviceSeparator := strings.LastIndexByte(serviceIdentity, '.')
	if serviceSeparator <= 0 || serviceSeparator == len(serviceIdentity)-1 {
		return Target{}, fmt.Errorf("rendered Athenz service %q must contain a domain and service name", serviceIdentity)
	}
	domain := serviceIdentity[:serviceSeparator]
	serviceName := serviceIdentity[serviceSeparator+1:]
	if !simpleNamePattern.MatchString(serviceName) {
		return Target{}, fmt.Errorf("rendered Athenz service name %q is not a valid simple name", serviceName)
	}

	domainSeparator := strings.LastIndexByte(domain, '.')
	if domainSeparator <= 0 || domainSeparator == len(domain)-1 {
		return Target{}, fmt.Errorf("rendered Athenz service domain %q must contain a parent domain and subdomain", domain)
	}

	parent := domain[:domainSeparator]
	expectedParent := "home." + username
	if parent != expectedParent {
		return Target{}, fmt.Errorf("rendered Athenz service domain %q must be directly under %q", domain, expectedParent)
	}
	subdomainName := domain[domainSeparator+1:]
	if !simpleNamePattern.MatchString(subdomainName) {
		return Target{}, fmt.Errorf("rendered Athenz subdomain name %q is not a valid simple name", subdomainName)
	}

	return Target{
		PreferredUsername: username,
		UserPrincipal:     "user." + username,
		ParentDomain:      parent,
		SubdomainName:     subdomainName,
		Domain:            domain,
		ServiceName:       serviceName,
		ServiceIdentity:   serviceIdentity,
	}, nil
}

// Report records which resources changed. The reserved home top-level domain
// remains a server bootstrap prerequisite; the user's personal home domain is
// created through ZMS's dedicated user-domain API when needed.
type Report struct {
	Target           Target
	HomeDomainCreated bool
	SubdomainCreated bool
	OptionalAdmins   []AdminResult
	ServiceCreated   bool
}

// AdminResult records whether an optional administrator was added or was
// already present.
type AdminResult struct {
	Name  string
	Added bool
}

// Client authenticates ZMS calls with a caller-provided OIDC ID token.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a ZMS client. caFile is optional; when present, it is used
// to trust a private CA for the ZMS HTTPS endpoint.
func NewClient(baseURL, caFile string) (*Client, error) {
	httpClient, err := newHTTPClient(caFile)
	if err != nil {
		return nil, err
	}
	return NewClientWithHTTPClient(baseURL, httpClient)
}

// NewClientWithHTTPClient is primarily useful for tests and callers that
// already own transport policy.
func NewClientWithHTTPClient(baseURL string, httpClient *http.Client) (*Client, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid ZMS URL %q", baseURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("invalid ZMS URL scheme %q", parsed.Scheme)
	}
	if httpClient == nil {
		return nil, fmt.Errorf("ZMS HTTP client is required")
	}
	return &Client{baseURL: parsed.String(), httpClient: httpClient}, nil
}

func newHTTPClient(caFile string) (*http.Client, error) {
	if caFile == "" {
		return &http.Client{Timeout: 30 * time.Second}, nil
	}
	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("reading Athenz ca_file: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("no valid certificates in Athenz ca_file %q", caFile)
	}
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		},
	}, nil
}

// Ensure idempotently creates the user's personal home domain, its configured
// child subdomain, optional administrators, and service. It never creates the
// reserved home top-level domain, which ZMS owns during system bootstrap.
func (c *Client) Ensure(ctx context.Context, idToken string, target Target, optionalAdmins []string) (Report, error) {
	report := Report{Target: target}
	if strings.TrimSpace(idToken) == "" {
		return report, fmt.Errorf("ID token is required")
	}
	admins, err := normalizeOptionalAdmins(target.UserPrincipal, optionalAdmins)
	if err != nil {
		return report, err
	}

	created, err := c.ensureHomeDomain(ctx, idToken, target)
	if err != nil {
		return report, err
	}
	report.HomeDomainCreated = created

	adminUsers := append([]string{target.UserPrincipal}, admins...)
	created, err = c.ensureSubdomain(ctx, idToken, target, adminUsers)
	if err != nil {
		return report, err
	}
	report.SubdomainCreated = created

	for _, admin := range admins {
		added, err := c.ensureAdmin(ctx, idToken, target, admin)
		if err != nil {
			return report, err
		}
		report.OptionalAdmins = append(report.OptionalAdmins, AdminResult{Name: admin, Added: added})
	}

	created, err = c.ensureService(ctx, idToken, target)
	if err != nil {
		return report, err
	}
	report.ServiceCreated = created

	return report, nil
}

func (c *Client) ensureHomeDomain(ctx context.Context, token string, target Target) (bool, error) {
	domainPath := "/domain/" + escape(target.ParentDomain)
	status, body, err := c.request(ctx, token, http.MethodGet, domainPath, nil)
	if err != nil {
		return false, fmt.Errorf("checking personal home domain: %w", err)
	}
	if status == http.StatusOK {
		return false, nil
	}
	if status != http.StatusNotFound {
		return false, unexpectedStatus("checking personal home domain", status, body)
	}

	// ZMS's user-domain API creates home.<username> and makes the authenticated
	// user its administrator. It does not create or modify the reserved home TLD.
	requestBody, _ := json.Marshal(struct {
		Name string `json:"name"`
	}{Name: target.PreferredUsername})
	status, body, err = c.request(ctx, token, http.MethodPost,
		"/userdomain/"+escape(target.PreferredUsername), requestBody)
	if err != nil {
		return false, fmt.Errorf("creating personal home domain: %w", err)
	}
	created := status >= 200 && status < 300
	if !created && status != http.StatusConflict {
		return false, unexpectedStatus("creating personal home domain", status, body)
	}

	status, body, err = c.request(ctx, token, http.MethodGet, domainPath, nil)
	if err != nil {
		return false, fmt.Errorf("verifying personal home domain: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("verifying personal home domain", status, body)
	}
	return created, nil
}

// EnsureProviderAuthorization applies Athenz's identity_provisioning solution
// template when needed so the configured instance provider may launch the
// target service. It must run after Ensure because the child domain and service
// are template inputs and may have just been created.
func (c *Client) EnsureProviderAuthorization(ctx context.Context, idToken string, target Target, provider string) (bool, error) {
	if strings.TrimSpace(idToken) == "" {
		return false, fmt.Errorf("ID token is required")
	}
	if !memberNamePattern.MatchString(provider) {
		return false, fmt.Errorf("instance provider %q is not a valid Athenz service name", provider)
	}

	rolePath := "/domain/" + escape(target.Domain) + "/role/identityproviders"
	status, body, err := c.request(ctx, idToken, http.MethodGet, rolePath, nil)
	if err != nil {
		return false, fmt.Errorf("checking instance-provider authorization: %w", err)
	}
	if status == http.StatusOK {
		present, err := roleContains(body, provider)
		if err != nil {
			return false, fmt.Errorf("checking instance-provider authorization: %w", err)
		}
		if present {
			return false, nil
		}
	} else if status != http.StatusNotFound {
		return false, unexpectedStatus("checking instance-provider authorization", status, body)
	}

	requestBody, _ := json.Marshal(struct {
		TemplateNames []string `json:"templateNames"`
		Params        []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"params"`
	}{
		TemplateNames: []string{"identity_provisioning"},
		Params: []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}{
			{Name: "instanceprovider", Value: provider},
			{Name: "service", Value: target.ServiceName},
		},
	})
	status, body, err = c.request(ctx, idToken, http.MethodPut,
		"/domain/"+escape(target.Domain)+"/template", requestBody)
	if err != nil {
		return false, fmt.Errorf("applying identity_provisioning template: %w", err)
	}
	if status < 200 || status >= 300 {
		return false, unexpectedStatus("applying identity_provisioning template", status, body)
	}

	status, body, err = c.request(ctx, idToken, http.MethodGet, rolePath, nil)
	if err != nil {
		return false, fmt.Errorf("verifying instance-provider authorization: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("verifying instance-provider authorization", status, body)
	}
	present, err := roleContains(body, provider)
	if err != nil {
		return false, fmt.Errorf("verifying instance-provider authorization: %w", err)
	}
	if !present {
		return false, fmt.Errorf("instance provider %q was not authorized after applying identity_provisioning", provider)
	}
	return true, nil
}

func normalizeOptionalAdmins(owner string, optionalAdmins []string) ([]string, error) {
	seen := map[string]struct{}{owner: {}}
	admins := make([]string, 0, len(optionalAdmins))
	for _, configured := range optionalAdmins {
		admin := strings.TrimSpace(configured)
		if !memberNamePattern.MatchString(admin) {
			return nil, fmt.Errorf("optional administrator %q is not a valid Athenz member name", configured)
		}
		if _, exists := seen[admin]; exists {
			continue
		}
		seen[admin] = struct{}{}
		admins = append(admins, admin)
	}
	return admins, nil
}

func (c *Client) ensureSubdomain(ctx context.Context, token string, target Target, adminUsers []string) (bool, error) {
	status, _, err := c.request(ctx, token, http.MethodGet, "/domain/"+escape(target.Domain), nil)
	if err != nil {
		return false, fmt.Errorf("checking local subdomain: %w", err)
	}
	if status == http.StatusOK {
		return false, nil
	}
	if status != http.StatusNotFound {
		return false, unexpectedStatus("checking local subdomain", status, nil)
	}

	// This payload contains only strings and string slices, so json.Marshal
	// cannot fail.
	body, _ := json.Marshal(struct {
		Parent     string   `json:"parent"`
		Name       string   `json:"name"`
		AdminUsers []string `json:"adminUsers"`
	}{Parent: target.ParentDomain, Name: target.SubdomainName, AdminUsers: adminUsers})

	status, responseBody, err := c.request(ctx, token, http.MethodPost, "/subdomain/"+escape(target.ParentDomain), body)
	if err != nil {
		return false, fmt.Errorf("creating local subdomain: %w", err)
	}
	created := status >= 200 && status < 300
	if !created && status != http.StatusConflict {
		return false, unexpectedStatus("creating local subdomain", status, responseBody)
	}

	status, responseBody, err = c.request(ctx, token, http.MethodGet, "/domain/"+escape(target.Domain), nil)
	if err != nil {
		return false, fmt.Errorf("verifying local subdomain: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("verifying local subdomain", status, responseBody)
	}
	return created, nil
}

func (c *Client) ensureAdmin(ctx context.Context, token string, target Target, admin string) (bool, error) {
	rolePath := "/domain/" + escape(target.Domain) + "/role/admin"
	status, body, err := c.request(ctx, token, http.MethodGet, rolePath, nil)
	if err != nil {
		return false, fmt.Errorf("checking local subdomain administrators: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("checking local subdomain administrators", status, body)
	}
	present, err := roleContains(body, admin)
	if err != nil {
		return false, err
	}
	if present {
		return false, nil
	}

	// This payload contains only strings, so json.Marshal cannot fail.
	requestBody, _ := json.Marshal(struct {
		MemberName string `json:"memberName"`
		RoleName   string `json:"roleName"`
	}{MemberName: admin, RoleName: "admin"})
	memberPath := rolePath + "/member/" + escape(admin)
	status, body, err = c.request(ctx, token, http.MethodPut, memberPath, requestBody)
	if err != nil {
		return false, fmt.Errorf("adding optional administrator: %w", err)
	}
	if status < 200 || status >= 300 {
		return false, unexpectedStatus("adding optional administrator", status, body)
	}

	status, body, err = c.request(ctx, token, http.MethodGet, rolePath, nil)
	if err != nil {
		return false, fmt.Errorf("verifying optional administrator: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("verifying optional administrator", status, body)
	}
	present, err = roleContains(body, admin)
	if err != nil {
		return false, err
	}
	if !present {
		return false, fmt.Errorf("optional administrator %q was not present after update", admin)
	}
	return true, nil
}

func roleContains(body []byte, member string) (bool, error) {
	var role struct {
		RoleMembers []struct {
			MemberName string `json:"memberName"`
		} `json:"roleMembers"`
		Members []string `json:"members"`
	}
	if err := json.Unmarshal(body, &role); err != nil {
		return false, fmt.Errorf("decoding admin role response: %w", err)
	}
	for _, roleMember := range role.RoleMembers {
		if roleMember.MemberName == member {
			return true, nil
		}
	}
	for _, roleMember := range role.Members {
		if roleMember == member {
			return true, nil
		}
	}
	return false, nil
}

func (c *Client) ensureService(ctx context.Context, token string, target Target) (bool, error) {
	servicePath := "/domain/" + escape(target.Domain) + "/service/" + escape(target.ServiceName)
	status, body, err := c.request(ctx, token, http.MethodGet, servicePath, nil)
	if err != nil {
		return false, fmt.Errorf("checking athenzd service: %w", err)
	}
	if status == http.StatusOK {
		return verifyServiceName(body, target.ServiceIdentity)
	}
	if status != http.StatusNotFound {
		return false, unexpectedStatus("checking athenzd service", status, body)
	}

	// This payload contains only a string, so json.Marshal cannot fail.
	requestBody, _ := json.Marshal(struct {
		Name string `json:"name"`
	}{Name: target.ServiceIdentity})
	status, body, err = c.request(ctx, token, http.MethodPut, servicePath, requestBody)
	if err != nil {
		return false, fmt.Errorf("creating athenzd service: %w", err)
	}
	if status < 200 || status >= 300 {
		return false, unexpectedStatus("creating athenzd service", status, body)
	}

	status, body, err = c.request(ctx, token, http.MethodGet, servicePath, nil)
	if err != nil {
		return false, fmt.Errorf("verifying athenzd service: %w", err)
	}
	if status != http.StatusOK {
		return false, unexpectedStatus("verifying athenzd service", status, body)
	}
	if _, err := verifyServiceName(body, target.ServiceIdentity); err != nil {
		return false, err
	}
	return true, nil
}

func verifyServiceName(body []byte, expected string) (bool, error) {
	var service struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &service); err != nil {
		return false, fmt.Errorf("decoding athenzd service response: %w", err)
	}
	if service.Name != expected {
		return false, fmt.Errorf("ZMS returned service %q, expected %q", service.Name, expected)
	}
	return false, nil
}

func (c *Client) request(ctx context.Context, token, method, path string, body []byte) (int, []byte, error) {
	// NewClient validates baseURL, all methods are HTTP constants, and all path
	// components are URL-escaped before reaching this method.
	request, _ := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return 0, nil, err
	}
	return response.StatusCode, responseBody, nil
}

func unexpectedStatus(operation string, status int, body []byte) error {
	message := strings.TrimSpace(string(body))
	if message == "" {
		return fmt.Errorf("%s failed with HTTP %d", operation, status)
	}
	return fmt.Errorf("%s failed with HTTP %d: %s", operation, status, message)
}

func escape(value string) string {
	return url.PathEscape(value)
}
