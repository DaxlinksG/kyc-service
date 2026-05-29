#!/bin/bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
cd /Users/da/Desktop/kyc-service
exec npm run dev --workspace=packages/admin
