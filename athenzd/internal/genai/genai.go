// Package genai defines the configurable Athenz naming convention used to
// discover GenAI service projects and their ID-JAG scopes.
package genai

import (
	"fmt"
	"regexp"
	"strings"
)

const ExchangerSuffix = "-jag-exchanger"

var (
	serviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]*$`)
	roleNamePattern    = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*$`)
	domainNamePattern  = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*$`)
)

// DomainMatcher recognizes service-project domains represented by one
// {{service}} (or Go-template-style {{.service}}) placeholder.
type DomainMatcher struct {
	prefix string
	suffix string
}

// ServiceScopes contains the roles that can be placed into one ID-JAG for a
// discovered service project.
type ServiceScopes struct {
	Service string
	Domain  string
	Scopes  []string
}

// ParseDomainTemplate validates and compiles a service-project domain template.
func ParseDomainTemplate(value string) (DomainMatcher, error) {
	template := strings.TrimSpace(value)
	template = strings.ReplaceAll(template, "{{.service}}", "{{service}}")
	const placeholder = "{{service}}"
	if strings.Count(template, placeholder) != 1 {
		return DomainMatcher{}, fmt.Errorf("GenAI domain %q must contain exactly one %s placeholder", value, placeholder)
	}
	parts := strings.SplitN(template, placeholder, 2)
	if !validDomainFragment(parts[0]) || !validDomainFragment(parts[1]) {
		return DomainMatcher{}, fmt.Errorf("GenAI domain %q contains an invalid Athenz domain fragment", value)
	}
	return DomainMatcher{prefix: parts[0], suffix: parts[1]}, nil
}

func validDomainFragment(fragment string) bool {
	if fragment == "" {
		return true
	}
	if strings.ContainsAny(fragment, ":/ ") {
		return false
	}
	trimmed := strings.Trim(fragment, ".")
	return trimmed != "" && domainNamePattern.MatchString(trimmed)
}

// Match returns the service-project name represented by domain.
func (matcher DomainMatcher) Match(domain string) (string, bool) {
	if !strings.HasPrefix(domain, matcher.prefix) || !strings.HasSuffix(domain, matcher.suffix) {
		return "", false
	}
	service := strings.TrimSuffix(strings.TrimPrefix(domain, matcher.prefix), matcher.suffix)
	if !serviceNamePattern.MatchString(service) {
		return "", false
	}
	return service, true
}

// ValidateRole validates the simple role configured as the baseline GenAI
// project membership.
func ValidateRole(role string) error {
	if !roleNamePattern.MatchString(strings.TrimSpace(role)) || strings.HasSuffix(role, ExchangerSuffix) {
		return fmt.Errorf("GenAI role %q is not a valid target role name", role)
	}
	return nil
}

// ValidateService validates the service-project key substituted into the
// configured GenAI domain template.
func ValidateService(service string) error {
	if !serviceNamePattern.MatchString(service) {
		return fmt.Errorf("GenAI project %q is not a valid service-project name", service)
	}
	return nil
}

// Scope returns a fully qualified Athenz role scope.
func Scope(domain, role string) string {
	return domain + ":role." + role
}

// SplitScope separates a fully qualified role into its domain and simple role.
func SplitScope(scope string) (string, string, bool) {
	const separator = ":role."
	parts := strings.Split(scope, separator)
	if len(parts) != 2 || parts[0] == "" || !roleNamePattern.MatchString(parts[1]) {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// TargetFromExchanger maps <role>-jag-exchanger membership in domain to the
// target role that can be requested as an ID-JAG scope.
func TargetFromExchanger(domain, exchangerRole string) (string, bool) {
	roleDomain, roleName, ok := SplitScope(exchangerRole)
	if !ok || roleDomain != domain || !strings.HasSuffix(roleName, ExchangerSuffix) {
		return "", false
	}
	targetName := strings.TrimSuffix(roleName, ExchangerSuffix)
	return Scope(domain, targetName), true
}
