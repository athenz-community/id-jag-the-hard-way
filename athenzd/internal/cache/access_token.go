package cache

import "time"

// AccessTokenEntry is the single access token selected for the config's
// default GenAI project. It is deliberately distinct from IDJAGEntry.
type AccessTokenEntry struct {
	Project   string    `json:"project"`
	Scope     string    `json:"scope"`
	Token     string    `json:"token"`
	TokenType string    `json:"token_type,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
}
