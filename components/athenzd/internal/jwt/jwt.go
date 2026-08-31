// Package jwt decodes (but does not verify) JWT claims for display purposes.
// The token was already obtained over a trusted TLS channel during login, so
// this package only needs to read the payload — it is not a security boundary.
package jwt

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

// Claims holds the subset of standard OIDC claims athenzd displays.
// Raw holds every claim so callers can print the full payload if they want.
type Claims struct {
	Issuer            string   `json:"iss"`
	Subject           string   `json:"sub"`
	Audience          Audience `json:"aud"`
	PreferredUsername string   `json:"preferred_username"`
	Email             string   `json:"email"`
	Name              string   `json:"name"`
	IssuedAt          int64    `json:"iat"`
	Expiry            int64    `json:"exp"`

	Raw map[string]any `json:"-"`
}

// Audience is an OIDC "aud" claim, which per RFC 7519 may be either a single
// string or an array of strings. It always renders as a single string.
type Audience string

func (a *Audience) UnmarshalJSON(b []byte) error {
	// Try a plain string first.
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*a = Audience(s)
		return nil
	}
	// Fall back to an array; join with commas.
	var arr []string
	if err := json.Unmarshal(b, &arr); err != nil {
		return fmt.Errorf("aud is neither string nor string array: %w", err)
	}
	*a = Audience(strings.Join(arr, ", "))
	return nil
}

// Decode parses the payload segment of a JWT without verifying its signature.
func Decode(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed JWT: expected 3 segments, got %d", len(parts))
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decoding JWT payload: %w", err)
	}

	// Parse the full claim set once. This both validates the JSON and gives
	// callers access to every claim via Raw.
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, fmt.Errorf("parsing JWT claims: %w", err)
	}

	// Decode the typed fields we display. The payload already parsed as a JSON
	// object above, so the only way this errors is a type mismatch on a typed
	// field (e.g. a non-string, non-array aud) — which is a real, tested case.
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, fmt.Errorf("parsing JWT claims: %w", err)
	}
	c.Raw = raw

	return &c, nil
}
