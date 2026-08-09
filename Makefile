# CoreHR Hub - Development Makefile
# Common commands for local development with Docker

.PHONY: help up down stop restart logs logs-db logs-auth logs-api logs-studio \
        ps clean clean-volumes migrate seed shell-db status health \
        dev build install test lint format

# Default target
help:
	@echo "CoreHR Hub - Development Commands"
	@echo ""
	@echo "Docker Commands:"
	@echo "  make up              - Start all services in detached mode"
	@echo "  make down            - Stop and remove all containers"
	@echo "  make stop            - Stop all containers (keep containers)"
	@echo "  make restart         - Restart all services"
	@echo "  make ps              - Show running containers"
	@echo "  make status          - Show detailed status of all services"
	@echo "  make health          - Check health of all services"
	@echo ""
	@echo "Logs Commands:"
	@echo "  make logs            - Follow logs from all services"
	@echo "  make logs-db         - Follow PostgreSQL logs"
	@echo "  make logs-auth       - Follow GoTrue auth logs"
	@echo "  make logs-api        - Follow PostgREST API logs"
	@echo "  make logs-studio     - Follow Supabase Studio logs"
	@echo "  make logs-functions  - Follow Edge Functions logs"
	@echo ""
	@echo "Database Commands:"
	@echo "  make migrate         - Run database migrations"
	@echo "  make seed            - Seed database with sample data"
	@echo "  make shell-db        - Open PostgreSQL shell"
	@echo "  make reset-db        - Reset database (WARNING: destroys data)"
	@echo ""
	@echo "Development Commands:"
	@echo "  make dev             - Start the Vite development server"
	@echo "  make build           - Build the application for production"
	@echo "  make install         - Install npm dependencies"
	@echo "  make test            - Run tests"
	@echo "  make lint            - Run ESLint"
	@echo "  make format          - Format code with Prettier"
	@echo "  make update-version  - Update APP_VERSION from latest git tag"
	@echo ""
	@echo "Cleanup Commands:"
	@echo "  make clean           - Stop containers and remove images"
	@echo "  make clean-volumes   - Remove all volumes (WARNING: destroys data)"
	@echo ""

# ============================================================================
# Docker Commands
# ============================================================================

up:
	@echo "Starting all services..."
	docker-compose up -d
	@echo ""
	@echo "Services are starting up. Access points:"
	@echo "  - App:            http://localhost:5173"
	@echo "  - Supabase API:   http://localhost:54321"
	@echo "  - Supabase Studio: http://localhost:54323"
	@echo "  - Email Testing:  http://localhost:54324"
	@echo ""
	@echo "Run 'make logs' to follow the logs"

down:
	@echo "Stopping and removing all containers..."
	docker-compose down

stop:
	@echo "Stopping all containers..."
	docker-compose stop

restart:
	@echo "Restarting all services..."
	docker-compose restart

ps:
	docker-compose ps

status:
	@echo "=== Container Status ==="
	@docker-compose ps
	@echo ""
	@echo "=== Resource Usage ==="
	@docker stats --no-stream $$(docker-compose ps -q) 2>/dev/null || echo "No containers running"

health:
	@echo "Checking service health..."
	@echo ""
	@echo "PostgreSQL:"
	@docker-compose exec -T db pg_isready -U postgres 2>/dev/null && echo "  ✓ Healthy" || echo "  ✗ Not responding"
	@echo ""
	@echo "PostgREST API:"
	@curl -s -o /dev/null -w "  Response: %{http_code}\n" http://localhost:54321/rest/v1/ 2>/dev/null || echo "  ✗ Not responding"
	@echo ""
	@echo "GoTrue Auth:"
	@curl -s -o /dev/null -w "  Response: %{http_code}\n" http://localhost:54321/auth/v1/health 2>/dev/null || echo "  ✗ Not responding"
	@echo ""
	@echo "Supabase Studio:"
	@curl -s -o /dev/null -w "  Response: %{http_code}\n" http://localhost:54323 2>/dev/null || echo "  ✗ Not responding"

# ============================================================================
# Logs Commands
# ============================================================================

logs:
	docker-compose logs -f

logs-db:
	docker-compose logs -f db

logs-auth:
	docker-compose logs -f auth

logs-api:
	docker-compose logs -f rest

logs-studio:
	docker-compose logs -f studio

logs-functions:
	docker-compose logs -f functions

logs-kong:
	docker-compose logs -f kong

logs-storage:
	docker-compose logs -f storage

logs-realtime:
	docker-compose logs -f realtime

# ============================================================================
# Database Commands
# ============================================================================

migrate:
	@echo "Running database migrations..."
	@for file in supabase/migrations/*.sql; do \
		if [ -f "$$file" ]; then \
			echo "Applying: $$file"; \
			docker-compose exec -T db psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/$$(basename $$file); \
		fi \
	done
	@echo "Migrations complete!"

seed:
	@echo "Seeding database..."
	@if [ -f "supabase/seed.sql" ]; then \
		docker-compose exec -T db psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/seed.sql; \
		echo "Seeding complete!"; \
	else \
		echo "No seed file found at supabase/seed.sql"; \
	fi

shell-db:
	@echo "Opening PostgreSQL shell..."
	docker-compose exec db psql -U postgres -d postgres

reset-db:
	@echo "WARNING: This will destroy all data in the database!"
	@read -p "Are you sure? (y/N) " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "Resetting database..."
	docker-compose down -v
	docker-compose up -d db
	@echo "Waiting for database to be ready..."
	@sleep 5
	docker-compose up -d
	@echo "Database reset complete!"

# ============================================================================
# Development Commands
# ============================================================================

dev:
	npm run dev

build:
	npm run build

install:
	npm install

test:
	npm run test 2>/dev/null || echo "No test script configured"

lint:
	npm run lint

format:
	npx prettier --write "src/**/*.{ts,tsx,js,jsx,json,css,md}"

update-version:
	@echo "Updating APP_VERSION from git tag..."
	@chmod +x scripts/update-version.sh
	@./scripts/update-version.sh

# ============================================================================
# Cleanup Commands
# ============================================================================

clean:
	@echo "Stopping containers and removing images..."
	docker-compose down --rmi local

clean-volumes:
	@echo "WARNING: This will remove all volumes and destroy all data!"
	@read -p "Are you sure? (y/N) " confirm && [ "$$confirm" = "y" ] || exit 1
	docker-compose down -v
	@echo "Volumes removed!"

# ============================================================================
# Quick Start
# ============================================================================

setup: install up
	@echo ""
	@echo "Setup complete! Run 'make dev' to start the frontend."

first-run:
	@echo "Setting up CoreHR Hub for first time..."
	@if [ ! -f ".env" ]; then \
		echo "Creating .env file from .env.example..."; \
		cp .env.example .env; \
		echo "Please edit .env with your configuration before proceeding."; \
		exit 1; \
	fi
	@$(MAKE) install
	@$(MAKE) up
	@echo "Waiting for services to be ready..."
	@sleep 10
	@$(MAKE) migrate
	@echo ""
	@echo "First run setup complete!"
	@echo "Run 'make dev' to start the frontend development server."
