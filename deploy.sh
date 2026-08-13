#!/bin/bash

# Stop script on any error
set -e

# =================================================================
# Wren - Zero-Downtime Deployment Script
# This script uses a blue-green deployment strategy.
# =================================================================

# --- Configuration ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

RELEASES_DIR="releases"
SHARED_DIR="shared"
CURRENT_SYMLINK="current"
BRANCH="main"

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE} TARGETING: WREN BOT DEPLOYMENT (${BRANCH})       ${NC}"
echo -e "${BLUE}==================================================${NC}"

# --- Pre-flight Checks ---
if ! command -v git &> /dev/null; then
    echo -e "${RED}[ERROR] 'git' command not found. Please install it to proceed.${NC}"
    exit 1
fi
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[ERROR] 'npm' command not found. Please install Node.js and npm.${NC}"
    exit 1
fi
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 not found. Installing globally...${NC}"
    sudo npm install -g pm2
fi

# --- 1. Setup Directories ---
echo -e "${YELLOW}[1/6] Setting up directories...${NC}"
mkdir -p ${RELEASES_DIR}
mkdir -p ${SHARED_DIR}

RELEASE_NAME=$(date +"%Y%m%d%H%M%S")
NEW_RELEASE_DIR="${RELEASES_DIR}/${RELEASE_NAME}"
mkdir -p "${NEW_RELEASE_DIR}"
echo -e "New release directory: ${GREEN}${NEW_RELEASE_DIR}${NC}"

# --- 2. Environment Configuration & DB Setup ---
echo -e "${YELLOW}[2/6] Configuring environment & database...${NC}"
SHARED_ENV_FILE="${SHARED_DIR}/.env"

if [ -f "${SHARED_ENV_FILE}" ]; then
    echo -e "${GREEN}Existing .env file found. Loading configuration...${NC}"
    # set -a exports everything the file defines; unlike `export $(... | xargs)`
    # this survives values containing spaces, quotes, or '='.
    set -a
    # shellcheck disable=SC1090
    . "${SHARED_ENV_FILE}"
    set +a

    # Backfilled after this var was added — existing .env files predate it.
    if ! grep -q "^WREN_METRICS_SECRET=" "${SHARED_ENV_FILE}"; then
        echo -e "${YELLOW}Adding missing WREN_METRICS_SECRET...${NC}"
        NEW_METRICS_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
        echo "WREN_METRICS_SECRET=${NEW_METRICS_SECRET}" >> "${SHARED_ENV_FILE}"
        export WREN_METRICS_SECRET="${NEW_METRICS_SECRET}"
    fi
else
    echo -e "${YELLOW}No existing .env file found. Starting first-time setup...${NC}"
    
    echo -e "${BLUE}=== ENTERING SECRETS ===${NC}"
    read -s -p "GitHub Personal Access Token (for private repo): " GITHUB_PAT; echo
    read -s -p "Discord Bot Token: " DISCORD_TOKEN; echo
    read -s -p "OpenRouter API Key: " OPENROUTER_API_KEY; echo
    read -p "OpenRouter Model [mistralai/mistral-large-2411]: " OPENROUTER_MODEL
    OPENROUTER_MODEL=${OPENROUTER_MODEL:-mistralai/mistral-large-2411}
    read -s -p "Brave Search API Key (Optional, press enter to skip): " BRAVE_SEARCH_API_KEY; echo
    read -p "API Listen Port [4167]: " API_PORT
    API_PORT=${API_PORT:-4167}
    read -s -p "PostHog API Key (Optional, for observability): " POSTHOG_API_KEY; echo
    read -p "Atria Staff Discord User IDs, comma-separated (Optional, enables \$atria admin commands): " ATRIA_STAFF_IDS

    echo -e "${BLUE}=== DATABASE CONFIGURATION ===${NC}"
    read -p "Database Host [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}
    
    DETECTED_PORT=$(sudo -u postgres psql -tAc "SHOW port;" 2>/dev/null || echo "5432")
    read -p "Database Port [$DETECTED_PORT]: " DB_PORT
    DB_PORT=${DB_PORT:-$DETECTED_PORT}
    
    read -p "Database Name [wren_prod]: " DB_NAME
    DB_NAME=${DB_NAME:-wren_prod}
    read -p "Database User [wren]: " DB_USER
    DB_USER=${DB_USER:-wren}
    read -s -p "Database Password: " DB_PASS; echo
    # Escape single quotes for safe interpolation into SQL string literals
    DB_PASS_SQL=${DB_PASS//\'/\'\'}
    
    # We only attempt automatic DB creation if the host is localhost
    if [ "$DB_HOST" = "localhost" ] || [ "$DB_HOST" = "127.0.0.1" ]; then
        echo -e "${YELLOW}Checking if local Postgres database '${DB_NAME}' exists...${NC}"
        if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
            echo -e "${YELLOW}Database '${DB_NAME}' not found. Creating it safely...${NC}"
            
            # Check if user exists, if not create, else update password
            if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
                sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS_SQL}';"
            else
                sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS_SQL}';"
            fi
            
            # Create database owned by the user
            sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
            echo -e "${GREEN}Database '${DB_NAME}' and user '${DB_USER}' created successfully.${NC}"
        else
            echo -e "${GREEN}Database '${DB_NAME}' already exists. Skipping creation.${NC}"
        fi
    else
        echo -e "${YELLOW}External database host detected. Skipping automatic database creation.${NC}"
    fi
    
    echo -e "${YELLOW}Building secure DATABASE_URL...${NC}"
    DATABASE_URL=$(DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" node -e "
const u = new URL('postgresql://localhost');
u.username = process.env.DB_USER;
u.password = process.env.DB_PASS;
if (process.env.DB_HOST.startsWith('/')) {
  u.hostname = 'localhost';
  u.searchParams.set('host', process.env.DB_HOST);
} else {
  u.hostname = process.env.DB_HOST;
}
u.port = process.env.DB_PORT;
u.pathname = '/' + process.env.DB_NAME;
console.log(u.toString());
")

    
    echo -e "${YELLOW}Generating AES-256-GCM Tenant Encryption Key...${NC}"
    TENANT_SECRET_ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

    echo -e "${YELLOW}Generating Prometheus metrics secret...${NC}"
    WREN_METRICS_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

    cat <<EOF > "${SHARED_ENV_FILE}"
GITHUB_PAT=${GITHUB_PAT}
DISCORD_TOKEN=${DISCORD_TOKEN}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
OPENROUTER_MODEL=${OPENROUTER_MODEL}
BRAVE_SEARCH_API_KEY=${BRAVE_SEARCH_API_KEY}
DATABASE_URL=${DATABASE_URL}
TENANT_SECRET_ENC_KEY=${TENANT_SECRET_ENC_KEY}
API_PORT=${API_PORT}
POSTHOG_API_KEY=${POSTHOG_API_KEY}
ATRIA_STAFF_IDS=${ATRIA_STAFF_IDS}
WREN_METRICS_SECRET=${WREN_METRICS_SECRET}
EOF
    echo -e "${GREEN}Environment file created at ${SHARED_ENV_FILE}${NC}"
    export GITHUB_PAT=$GITHUB_PAT
fi

if [ -z "$GITHUB_PAT" ]; then
    echo -e "${RED}[ERROR] GITHUB_PAT is missing from .env. Deployment cannot proceed.${NC}"
    exit 1
fi

# --- 3. Fetch Code From GitHub ---
echo -e "${YELLOW}[3/6] Fetching code from private GitHub repo...${NC}"
GIT_TMP_DIR="${RELEASES_DIR}/.git_tmp_${RELEASE_NAME}"

# Hide PAT from output by running command silently if it fails, or redirecting properly
set +x
git clone -q -b ${BRANCH} "https://oauth2:${GITHUB_PAT}@github.com/atriasfty/wren.git" "${GIT_TMP_DIR}"
set -e

if [ ! -d "${GIT_TMP_DIR}" ]; then
    echo -e "${RED}[ERROR] Failed to clone the repository. Check your GitHub PAT.${NC}"
    exit 1
fi

shopt -s dotglob 2>/dev/null || true
mv "${GIT_TMP_DIR}/"* "${NEW_RELEASE_DIR}/" 2>/dev/null || true
shopt -u dotglob 2>/dev/null || true
rm -rf "${GIT_TMP_DIR}"

# --- 4. Install Dependencies & Migrate ---
echo -e "${YELLOW}[4/6] Preparing release...${NC}"
cd "${NEW_RELEASE_DIR}"

# Copy the environment file so Wren can read it securely without symlink issues
cp "../../${SHARED_ENV_FILE}" .env

echo -e "${YELLOW}Installing dependencies...${NC}"
npm ci --production

echo -e "${YELLOW}Running database migrations...${NC}"
npm run migrate

cd ../../

# --- 5. Switch Symlink ---
echo -e "${YELLOW}[5/6] Switching symlink to new release...${NC}"
ln -sfn "${NEW_RELEASE_DIR}" "${CURRENT_SYMLINK}"

# --- 6. Reload PM2 ---
echo -e "${YELLOW}[6/6] Reloading application with PM2...${NC}"
cd "${CURRENT_SYMLINK}"

echo -e "${YELLOW}Clearing old PM2 logs...${NC}"
rm -f /root/.pm2/logs/wren-out.log /root/.pm2/logs/wren-error.log

if pm2 show wren &> /dev/null; then
    echo -e "${GREEN}Restarting existing PM2 process (bypassing symlink cache)...${NC}"
    pm2 delete wren
    pm2 start src/index.js --name "wren"
    pm2 save
else
    echo -e "${GREEN}Starting new PM2 process...${NC}"
    pm2 start src/index.js --name "wren"
    pm2 save
fi

echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN} DEPLOYMENT SUCCESSFUL! Wren is now running!      ${NC}"
echo -e "${GREEN}==================================================${NC}"
