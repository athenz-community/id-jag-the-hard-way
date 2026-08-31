#!/bin/bash
set -e

##################################################################
### Imports ######################################################
##################################################################
# shellcheck disable=SC1091
source "$(dirname "$0")/utils/colors.sh"

##################################################################
### Shellscript Intro  ###########################################
##################################################################
echo -e "${CYAN}==============================================${NC}"
echo -e "${CYAN}     🚀 Keycloak Token Provider Plugin Deployment Wizard       ${NC}"
echo -e "${CYAN}==============================================${NC}"

##################################################################
### Prerequisites Check ##########################################
##################################################################

# Extract JAR Path from pom.xml
if [ ! -f "pom.xml" ]; then
    echo -e "${RED}[Error] pom.xml not found in current directory!${NC}"
    exit 1
fi

ARTIFACT_ID=$(grep -m 1 "<artifactId>" pom.xml | sed -e 's/^[[:space:]]*<artifactId>//' -e 's/<\/artifactId>[[:space:]]*$//')
JAR_VERSION=$(grep -m 1 "<version>" pom.xml | sed -e 's/^[[:space:]]*<version>//' -e 's/<\/version>[[:space:]]*$//')

if [ -z "$ARTIFACT_ID" ] || [ -z "$JAR_VERSION" ]; then
  echo -e "${RED}[Error] Failed to parse artifactId or JAR_VERSION from pom.xml${NC}"
  exit 1
else
  JAR_PATH="target/original-${ARTIFACT_ID}-${JAR_VERSION}.jar"
  echo -e "${GREEN}✅ Confirmed JAR Path: $JAR_PATH${NC}"
fi

if [ ! -f "$JAR_PATH" ]; then
  echo -e "${RED}[Error] JAR file not found: $JAR_PATH${NC}"
  exit 1
fi

##################################################################
### Interactive User Prompt ######################################
##################################################################

DEFAULT_NS="athenz"
DEFAULT_CM="keycloak-token-provider-jar"
DEFAULT_DEPLOY="athenz-zts-server"

# 2. Namespace
read -p "👉 Target K8s Namespace? [Hit enter for default: $DEFAULT_NS]: " INPUT_NS
NAMESPACE=${INPUT_NS:-$DEFAULT_NS}

# 3. ConfigMap Name
read -p "👉 K8s ConfigMap Name? [Hit enter for default: $DEFAULT_CM]: " INPUT_CM
CM_NAME=${INPUT_CM:-$DEFAULT_CM}

# 5. Restart Confirmation
read -p "👉 Restart Athenz ZTS Server after update? (Any non-Y is no) [Hit enter for default: Y]: " INPUT_RESTART
RESTART=${INPUT_RESTART:-Y}

# 4. Deployment Name
if [[ "$RESTART" =~ ^[Yy]$ ]]; then
  read -p "👉 Athenz ZTS deployment name? [Hit enter for default: $DEFAULT_DEPLOY]: " INPUT_DEPLOY
  ZTS_DEPLOYMENT=${INPUT_DEPLOY:-$DEFAULT_DEPLOY}
fi

echo -e "\n${CYAN}--- Summary ----------------------${NC}"
echo -e "Namespace             : ${GREEN}$NAMESPACE${NC}"
echo -e "ConfigMap             : ${GREEN}$CM_NAME${NC}"
echo -e "Athenz ZTS Deployment : ${GREEN}$ZTS_DEPLOYMENT${NC}"
echo -e "Jar File              : ${GREEN}$JAR_PATH${NC}"
echo -e "Restart?              : ${GREEN}$RESTART${NC}"
echo -e "${CYAN}------------------------------------${NC}\n"


##################################################################
### Core LOGIC ###################################################
##################################################################

echo -e "📦 Updating ConfigMap..."
kubectl delete cm "$CM_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl create cm "$CM_NAME" --from-file=keycloak-token-provider.jar="$JAR_PATH" -n "$NAMESPACE"

if [[ "$RESTART" =~ ^[Yy]$ ]]; then
  echo -e "🔄 Restarting Deployment..."
  kubectl rollout restart deployment "$ZTS_DEPLOYMENT" -n "$NAMESPACE"
  echo -e "${GREEN}✅ Done! Athenz ZTS Deployment restarted.${NC}"
else
  echo -e "${YELLOW}✋ Skipping Athenz ZTS Deployment restart. Only ConfigMap updated.${NC}"
fi
