package zms

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/AthenZ/athenzd/internal/genai"
)

// DiscoverGenAIScopes discovers every service project where the logged-in user
// has the configured baseline role. For each project it intersects all user
// roles with the local workload's matching <role>-jag-exchanger memberships.
func (c *Client) DiscoverGenAIScopes(ctx context.Context, idToken, userPrincipal, workloadPrincipal, domainTemplate, baselineRole string) ([]genai.ServiceScopes, error) {
	if strings.TrimSpace(idToken) == "" {
		return nil, fmt.Errorf("ID token is required")
	}
	if !memberNamePattern.MatchString(userPrincipal) {
		return nil, fmt.Errorf("user principal %q is not a valid Athenz principal", userPrincipal)
	}
	if !memberNamePattern.MatchString(workloadPrincipal) {
		return nil, fmt.Errorf("workload principal %q is not a valid Athenz service name", workloadPrincipal)
	}
	matcher, err := genai.ParseDomainTemplate(domainTemplate)
	if err != nil {
		return nil, err
	}
	if err := genai.ValidateRole(baselineRole); err != nil {
		return nil, err
	}
	baselineRole = strings.TrimSpace(baselineRole)

	// The ID token authenticates this request as the human. Passing the derived
	// user principal explicitly prevents the workload identity from becoming the
	// delegated subject by accident.
	query := url.Values{}
	query.Set("principal", userPrincipal)
	query.Set("expand", "true")
	status, body, err := c.request(ctx, idToken, http.MethodGet, "/role?"+query.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("listing GenAI roles for the logged-in user: %w", err)
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	if status != http.StatusOK {
		return nil, unexpectedStatus("listing GenAI roles for the logged-in user", status, body)
	}

	var userResponse struct {
		MemberRoles []struct {
			DomainName string `json:"domainName"`
			RoleName   string `json:"roleName"`
		} `json:"memberRoles"`
	}
	if err := json.Unmarshal(body, &userResponse); err != nil {
		return nil, fmt.Errorf("decoding GenAI roles for the logged-in user: %w", err)
	}

	type project struct {
		service   string
		userRoles map[string]struct{}
	}
	projects := map[string]*project{}
	for _, membership := range userResponse.MemberRoles {
		scope := membership.RoleName
		if !strings.Contains(scope, ":role.") {
			if membership.DomainName == "" {
				continue
			}
			scope = genai.Scope(membership.DomainName, scope)
		}
		domain, role, ok := genai.SplitScope(scope)
		if !ok || membership.DomainName != "" && membership.DomainName != domain {
			continue
		}
		service, ok := matcher.Match(domain)
		if !ok {
			continue
		}
		candidate := projects[domain]
		if candidate == nil {
			candidate = &project{service: service, userRoles: map[string]struct{}{}}
			projects[domain] = candidate
		}
		candidate.userRoles[role] = struct{}{}
	}

	domains := make([]string, 0, len(projects))
	for domain, candidate := range projects {
		if _, ok := candidate.userRoles[baselineRole]; ok {
			domains = append(domains, domain)
		}
	}
	sort.Strings(domains)

	result := make([]genai.ServiceScopes, 0, len(domains))
	for _, domain := range domains {
		candidate := projects[domain]
		exchangerRoles := make([]struct {
			DomainName string `json:"domainName"`
			RoleName   string `json:"roleName"`
		}, 0)

		// Expanded principal lookup covers exact, group, and delegated
		// membership. ZMS intentionally does not include prefix-wildcard role
		// members (for example home.*) in this response, so those are merged
		// from the domain membership listing below.
		roleQuery := url.Values{}
		roleQuery.Set("principal", workloadPrincipal)
		roleQuery.Set("domain", domain)
		roleQuery.Set("expand", "true")
		status, body, err = c.request(ctx, idToken, http.MethodGet, "/role?"+roleQuery.Encode(), nil)
		if err != nil {
			return nil, fmt.Errorf("listing exchanger roles for GenAI service %s: %w", candidate.service, err)
		}
		if status != http.StatusOK && status != http.StatusNotFound {
			return nil, unexpectedStatus("listing exchanger roles for GenAI service "+candidate.service, status, body)
		}
		if status == http.StatusOK {
			var exchangerResponse struct {
				MemberRoles []struct {
					DomainName string `json:"domainName"`
					RoleName   string `json:"roleName"`
				} `json:"memberRoles"`
			}
			if err := json.Unmarshal(body, &exchangerResponse); err != nil {
				return nil, fmt.Errorf("decoding exchanger roles for GenAI service %s: %w", candidate.service, err)
			}
			exchangerRoles = append(exchangerRoles, exchangerResponse.MemberRoles...)
		}

		status, body, err = c.request(ctx, idToken, http.MethodGet, "/domain/"+url.PathEscape(domain)+"/member", nil)
		if err != nil {
			return nil, fmt.Errorf("listing wildcard exchanger roles for GenAI service %s: %w", candidate.service, err)
		}
		if status != http.StatusOK {
			return nil, unexpectedStatus("listing wildcard exchanger roles for GenAI service "+candidate.service, status, body)
		}
		var domainMembers struct {
			Members []struct {
				MemberName  string `json:"memberName"`
				MemberRoles []struct {
					DomainName string `json:"domainName"`
					RoleName   string `json:"roleName"`
				} `json:"memberRoles"`
			} `json:"members"`
		}
		if err := json.Unmarshal(body, &domainMembers); err != nil {
			return nil, fmt.Errorf("decoding wildcard exchanger roles for GenAI service %s: %w", candidate.service, err)
		}
		for _, member := range domainMembers.Members {
			if !wildcardMemberMatches(member.MemberName, workloadPrincipal) {
				continue
			}
			for _, role := range member.MemberRoles {
				if role.DomainName == "" {
					role.DomainName = domain
				}
				exchangerRoles = append(exchangerRoles, role)
			}
		}

		scopeSet := map[string]struct{}{}
		for _, membership := range exchangerRoles {
			if membership.DomainName != "" && membership.DomainName != domain {
				continue
			}
			exchangerScope := membership.RoleName
			if !strings.Contains(exchangerScope, ":role.") {
				exchangerScope = genai.Scope(domain, exchangerScope)
			}
			targetScope, ok := genai.TargetFromExchanger(domain, exchangerScope)
			if !ok {
				continue
			}
			_, targetRole, _ := genai.SplitScope(targetScope)
			if _, ok := candidate.userRoles[targetRole]; ok {
				scopeSet[targetScope] = struct{}{}
			}
		}
		baselineScope := genai.Scope(domain, baselineRole)
		if _, ok := scopeSet[baselineScope]; !ok {
			continue
		}
		scopes := make([]string, 0, len(scopeSet))
		for scope := range scopeSet {
			scopes = append(scopes, scope)
		}
		sort.Strings(scopes)
		result = append(result, genai.ServiceScopes{Service: candidate.service, Domain: domain, Scopes: scopes})
	}
	return result, nil
}

// wildcardMemberMatches follows Athenz's role-member semantics: "*" matches
// every principal and any other trailing "*" is a literal prefix match.
func wildcardMemberMatches(memberName, principal string) bool {
	if memberName == "*" {
		return true
	}
	return strings.HasSuffix(memberName, "*") && strings.HasPrefix(principal, strings.TrimSuffix(memberName, "*"))
}
