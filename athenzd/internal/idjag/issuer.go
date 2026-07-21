// Package idjag orchestrates project discovery and ID-JAG issuance without
// coupling callers to CLI configuration, output, or token-cache concerns.
package idjag

import (
	"context"
	"fmt"
	"strings"

	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/zts"
)

// ScopeDiscoverer resolves the eligible scopes for every service project.
type ScopeDiscoverer interface {
	DiscoverGenAIScopes(ctx context.Context, idToken, userPrincipal, workloadPrincipal, domainTemplate, baselineRole string) ([]genai.ServiceScopes, error)
}

// TokenExchanger exchanges one subject token for one service project's scopes.
type TokenExchanger interface {
	ExchangeIDJAG(ctx context.Context, subjectToken, scope string) (*zts.IDJAG, error)
}

// ExchangerFactory delays loading the workload's X.509 identity until role
// discovery confirms that at least one token can be issued.
type ExchangerFactory func() (TokenExchanger, error)

// Request contains the identity and naming convention needed for issuance.
type Request struct {
	SubjectToken      string
	UserPrincipal     string
	WorkloadPrincipal string
	DomainTemplate    string
	BaselineRole      string
}

// Result is one ID-JAG for one discovered service project.
type Result struct {
	Service   string
	Domain    string
	Token     string
	Scope     string
	ExpiresIn int
}

// NoEligibleProjectsError means GenAI issuance is not applicable to this
// login. Callers may treat it as a friendly skip instead of a failure.
type NoEligibleProjectsError struct {
	UserPrincipal     string
	WorkloadPrincipal string
	DomainTemplate    string
	BaselineRole      string
}

func (e *NoEligibleProjectsError) Error() string {
	return fmt.Sprintf("no GenAI service project matching %q grants role %q to %s and the corresponding -jag-exchangers role to %s",
		e.DomainTemplate, e.BaselineRole, e.UserPrincipal, e.WorkloadPrincipal)
}

// Issuer coordinates discovery and exchange while leaving persistence and
// presentation to its caller.
type Issuer struct {
	discoverer   ScopeDiscoverer
	newExchanger ExchangerFactory
}

func NewIssuer(discoverer ScopeDiscoverer, newExchanger ExchangerFactory) *Issuer {
	return &Issuer{discoverer: discoverer, newExchanger: newExchanger}
}

// Discover returns every eligible project and role for the request. Keeping
// discovery separate lets callers present the roles before any exchange is
// attempted.
func (i *Issuer) Discover(ctx context.Context, request Request) ([]genai.ServiceScopes, error) {
	projects, err := i.discoverer.DiscoverGenAIScopes(ctx, request.SubjectToken, request.UserPrincipal, request.WorkloadPrincipal,
		request.DomainTemplate, request.BaselineRole)
	if err != nil {
		return nil, fmt.Errorf("discovering GenAI roles for user %s and workload %s: %w",
			request.UserPrincipal, request.WorkloadPrincipal, err)
	}
	if len(projects) == 0 {
		return nil, &NoEligibleProjectsError{
			UserPrincipal:     request.UserPrincipal,
			WorkloadPrincipal: request.WorkloadPrincipal,
			DomainTemplate:    request.DomainTemplate,
			BaselineRole:      request.BaselineRole,
		}
	}
	return projects, nil
}

// Issue returns one token per eligible project. Roles from different domains
// are intentionally never combined into the same ID-JAG.
func (i *Issuer) Issue(ctx context.Context, request Request) ([]Result, error) {
	projects, err := i.Discover(ctx, request)
	if err != nil {
		return nil, err
	}
	return i.IssueDiscovered(ctx, request.SubjectToken, projects)
}

// IssueDiscovered exchanges roles returned by Discover for ID-JAGs without
// repeating discovery.
func (i *Issuer) IssueDiscovered(ctx context.Context, subjectToken string, projects []genai.ServiceScopes) ([]Result, error) {
	exchanger, err := i.newExchanger()
	if err != nil {
		return nil, err
	}
	results := make([]Result, 0, len(projects))
	for _, project := range projects {
		token, err := exchanger.ExchangeIDJAG(ctx, subjectToken, strings.Join(project.Scopes, " "))
		if err != nil {
			return nil, fmt.Errorf("issuing ID-JAG for GenAI service %s (%s): %w",
				project.Service, project.Domain, err)
		}
		results = append(results, Result{
			Service:   project.Service,
			Domain:    project.Domain,
			Token:     token.AccessToken,
			Scope:     token.Scope,
			ExpiresIn: token.ExpiresIn,
		})
	}
	return results, nil
}
