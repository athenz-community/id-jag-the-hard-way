// Package accesstoken orchestrates narrowing an issued ID-JAG into one Athenz
// access token. ID-JAG issuance itself belongs to the separate internal/idjag
// package.
package accesstoken

import (
	"context"
	"fmt"

	"github.com/AthenZ/athenzd/internal/zts"
)

// Exchanger performs the ZTS ID-JAG assertion grant.
type Exchanger interface {
	ExchangeIDJAGForAccessToken(ctx context.Context, assertion, scope string) (*zts.AccessToken, error)
}

// Result is one access token narrowed to one fully qualified OAuth scope.
type Result struct {
	Token     string
	Scope     string
	TokenType string
	ExpiresIn int
}

// Issue exchanges one ID-JAG for one access token without knowing about CLI
// configuration, prompts, or cache persistence.
func Issue(ctx context.Context, exchanger Exchanger, assertion, domainRole string) (*Result, error) {
	token, err := exchanger.ExchangeIDJAGForAccessToken(ctx, assertion, domainRole)
	if err != nil {
		return nil, fmt.Errorf("issuing access token for %s: %w", domainRole, err)
	}
	return &Result{
		Token:     token.Token,
		Scope:     token.Scope,
		TokenType: token.TokenType,
		ExpiresIn: token.ExpiresIn,
	}, nil
}
