package zts

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/AthenZ/athenzd/internal/jwt"
)

const (
	idJAGGrantType     = "urn:ietf:params:oauth:grant-type:token-exchange"
	idJAGTokenType     = "urn:ietf:params:oauth:token-type:id-jag"
	idTokenSubjectType = "urn:ietf:params:oauth:token-type:id_token"
)

// IDJAG is a scoped identity assertion issued for a human subject and the
// authenticated local workload.
type IDJAG struct {
	AccessToken string
	Scope       string
	TokenType   string
	ExpiresIn   int
}

// TokenExchangeError reports a non-successful ZTS OAuth response.
type TokenExchangeError struct {
	StatusCode int
	Message    string
}

func (e *TokenExchangeError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("ZTS ID-JAG exchange failed with HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("ZTS ID-JAG exchange failed with HTTP %d: %s", e.StatusCode, e.Message)
}

// NewIdentityClient creates a ZTS client authenticated with the locally
// enrolled X.509 service certificate and private key.
func NewIdentityClient(baseURL, caFile, certFile, keyFile string) (*Client, error) {
	certificatePath, err := expandPath(certFile)
	if err != nil {
		return nil, fmt.Errorf("resolving identity certificate: %w", err)
	}
	keyPath, err := expandPath(keyFile)
	if err != nil {
		return nil, fmt.Errorf("resolving identity private key: %w", err)
	}
	certificate, err := tls.LoadX509KeyPair(certificatePath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("loading identity certificate and private key: %w", err)
	}
	httpClient, err := newHTTPClient(caFile)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	if configured, ok := httpClient.Transport.(*http.Transport); ok {
		transport = configured.Clone()
		transport.TLSClientConfig = configured.TLSClientConfig.Clone()
	}
	transport.TLSClientConfig.Certificates = []tls.Certificate{certificate}
	httpClient.Transport = transport
	return NewClientWithHTTPClient(baseURL, httpClient)
}

// ExchangeIDJAG exchanges an OIDC ID token for all requested scopes. The HTTP
// request is mutually authenticated by the Client's transport.
func (c *Client) ExchangeIDJAG(ctx context.Context, subjectToken, scope string) (*IDJAG, error) {
	if strings.TrimSpace(subjectToken) == "" {
		return nil, fmt.Errorf("subject ID token is required")
	}
	requestedScopes := uniqueScopes(scope)
	if len(requestedScopes) == 0 {
		return nil, fmt.Errorf("ID-JAG scope is required")
	}
	requestedScope := strings.Join(requestedScopes, " ")

	issuer, err := c.openIDIssuer(ctx)
	if err != nil {
		return nil, err
	}
	form := url.Values{}
	form.Set("grant_type", idJAGGrantType)
	form.Set("requested_token_type", idJAGTokenType)
	form.Set("subject_token_type", idTokenSubjectType)
	form.Set("subject_token", subjectToken)
	form.Set("scope", requestedScope)
	form.Set("audience", issuer)

	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/oauth2/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("exchanging ID token for ID-JAG: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("reading ZTS ID-JAG response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, tokenExchangeStatus(response.StatusCode, body)
	}

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
	}
	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return nil, fmt.Errorf("decoding ZTS ID-JAG response: %w", err)
	}
	if tokenResponse.AccessToken == "" {
		return nil, fmt.Errorf("ZTS ID-JAG response did not contain access_token")
	}
	claims, err := jwt.Decode(tokenResponse.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("decoding issued ID-JAG: %w", err)
	}
	grantedScopes, err := tokenScopes(claims.Raw)
	if err != nil {
		return nil, err
	}
	if !containsAllScopes(grantedScopes, requestedScopes) {
		return nil, fmt.Errorf("issued ID-JAG scopes %q do not contain all requested scopes %q", strings.Join(grantedScopes, " "), requestedScope)
	}
	if tokenResponse.Scope != "" && !containsAllScopes(uniqueScopes(tokenResponse.Scope), requestedScopes) {
		return nil, fmt.Errorf("ZTS ID-JAG response scope %q does not contain all requested scopes %q", tokenResponse.Scope, requestedScope)
	}
	return &IDJAG{
		AccessToken: tokenResponse.AccessToken,
		Scope:       strings.Join(grantedScopes, " "),
		TokenType:   tokenResponse.TokenType,
		ExpiresIn:   tokenResponse.ExpiresIn,
	}, nil
}

func (c *Client) openIDIssuer(ctx context.Context) (string, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/.well-known/openid-configuration", nil)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("retrieving ZTS OpenID configuration: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("reading ZTS OpenID configuration: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("retrieving ZTS OpenID configuration: %w", tokenExchangeStatus(response.StatusCode, body))
	}
	var metadata struct {
		Issuer string `json:"issuer"`
	}
	if err := json.Unmarshal(body, &metadata); err != nil {
		return "", fmt.Errorf("decoding ZTS OpenID configuration: %w", err)
	}
	if strings.TrimSpace(metadata.Issuer) == "" {
		return "", fmt.Errorf("ZTS OpenID configuration did not contain issuer")
	}
	return metadata.Issuer, nil
}

func tokenScopes(claims map[string]any) ([]string, error) {
	for _, name := range []string{"scp", "scope"} {
		value, ok := claims[name]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			scopes := uniqueScopes(typed)
			if len(scopes) > 0 {
				return scopes, nil
			}
		case []any:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				text, ok := item.(string)
				if !ok || strings.TrimSpace(text) == "" {
					return nil, fmt.Errorf("issued ID-JAG contained a non-string %s scope", name)
				}
				values = append(values, text)
			}
			scopes := uniqueScopes(strings.Join(values, " "))
			if len(scopes) > 0 {
				return scopes, nil
			}
		default:
			return nil, fmt.Errorf("issued ID-JAG contained an invalid %s claim", name)
		}
	}
	return nil, fmt.Errorf("issued ID-JAG did not contain scp or scope claims")
}

func uniqueScopes(scope string) []string {
	set := map[string]struct{}{}
	for _, value := range strings.Fields(scope) {
		set[value] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func containsAllScopes(granted, requested []string) bool {
	set := make(map[string]struct{}, len(granted))
	for _, scope := range granted {
		set[scope] = struct{}{}
	}
	for _, scope := range requested {
		if _, ok := set[scope]; !ok {
			return false
		}
	}
	return true
}

func tokenExchangeStatus(status int, body []byte) error {
	var resourceError struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &resourceError) == nil && strings.TrimSpace(resourceError.Message) != "" {
		return &TokenExchangeError{StatusCode: status, Message: resourceError.Message}
	}
	return &TokenExchangeError{StatusCode: status, Message: strings.TrimSpace(string(body))}
}
