package zts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/AthenZ/athenzd/internal/jwt"
)

const (
	idJAGAssertionGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer"
	defaultATExpiresIn      = "3600"
)

// AccessToken is an Athenz access token narrowed from an ID-JAG to one role.
type AccessToken struct {
	Token     string
	Scope     string
	TokenType string
	ExpiresIn int
}

// AccessTokenExchangeError reports a non-successful ZTS ID-JAG assertion
// exchange.
type AccessTokenExchangeError struct {
	StatusCode int
	Message    string
}

func (e *AccessTokenExchangeError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("ZTS access-token exchange failed with HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("ZTS access-token exchange failed with HTTP %d: %s", e.StatusCode, e.Message)
}

// ExchangeIDJAGForAccessToken exchanges an ID-JAG assertion for one role
// access token. The HTTP request is mutually authenticated by the Client's
// transport.
func (c *Client) ExchangeIDJAGForAccessToken(ctx context.Context, assertion, scope string) (*AccessToken, error) {
	if strings.TrimSpace(assertion) == "" {
		return nil, fmt.Errorf("ID-JAG assertion is required")
	}
	requestedScopes := uniqueScopes(scope)
	if len(requestedScopes) != 1 {
		return nil, fmt.Errorf("exactly one access-token scope is required")
	}
	requestedScope := requestedScopes[0]

	form := url.Values{}
	form.Set("grant_type", idJAGAssertionGrantType)
	form.Set("assertion", assertion)
	form.Set("scope", requestedScope)
	form.Set("expires_in", defaultATExpiresIn)

	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/oauth2/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("exchanging ID-JAG for access token: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("reading ZTS access-token response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, accessTokenExchangeStatus(response.StatusCode, body)
	}

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
	}
	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return nil, fmt.Errorf("decoding ZTS access-token response: %w", err)
	}
	if tokenResponse.AccessToken == "" {
		return nil, fmt.Errorf("ZTS access-token response did not contain access_token")
	}
	claims, err := jwt.Decode(tokenResponse.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("decoding issued access token: %w", err)
	}
	grantedScopes, err := tokenScopes(claims.Raw)
	if err != nil {
		return nil, err
	}
	if !matchesAccessTokenScope(grantedScopes, requestedScope) {
		return nil, fmt.Errorf("issued access-token scopes %q do not exactly match requested scope %q", strings.Join(grantedScopes, " "), requestedScope)
	}
	if tokenResponse.Scope != "" {
		responseScopes := uniqueScopes(tokenResponse.Scope)
		if !matchesAccessTokenScope(responseScopes, requestedScope) {
			return nil, fmt.Errorf("ZTS access-token response scope %q does not exactly match requested scope %q", tokenResponse.Scope, requestedScope)
		}
	}
	return &AccessToken{
		Token:     tokenResponse.AccessToken,
		Scope:     requestedScope,
		TokenType: tokenResponse.TokenType,
		ExpiresIn: tokenResponse.ExpiresIn,
	}, nil
}

// matchesAccessTokenScope accepts the fully qualified Athenz role scope sent
// in the request and the role-only representation Athenz places in access
// tokens. It deliberately requires exactly one granted scope in either form.
func matchesAccessTokenScope(granted []string, requested string) bool {
	if len(granted) != 1 {
		return false
	}
	if granted[0] == requested {
		return true
	}
	_, role, qualified := strings.Cut(requested, ":role.")
	return qualified && role != "" && granted[0] == role
}

func accessTokenExchangeStatus(status int, body []byte) error {
	var resourceError struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &resourceError) == nil && strings.TrimSpace(resourceError.Message) != "" {
		return &AccessTokenExchangeError{StatusCode: status, Message: resourceError.Message}
	}
	return &AccessTokenExchangeError{StatusCode: status, Message: strings.TrimSpace(string(body))}
}
