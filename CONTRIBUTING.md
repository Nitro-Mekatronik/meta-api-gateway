# Contributing to Nitro Meta API Gateway

Thank you for your interest in contributing! Here are some guidelines:

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/meta-api-gateway.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/amazing-feature`
5. Make your changes
6. Test thoroughly: `npm test`
7. Commit with clear messages

## Code Style

- Use ESLint rules
- Follow existing code patterns
- Add comments for complex logic
- Write tests for new features

## Testing

Before submitting a PR:
- Run all tests: `npm test`
- Ensure coverage doesn't decrease
- Test with Docker: `docker-compose up -d`
- Verify health checks pass

## Pull Request Process

1. Update README.md if needed
2. Add tests for new functionality
3. Ensure all tests pass
4. Update documentation
5. Request review from maintainers

## Commit Messages

Format: `[TYPE] Description`

Examples:
- `feat: Add Google Chat handoff worker`
- `fix: Resolve queue mock issue in tests`
- `docs: Update README with usage examples`
- `test: Add integration tests for webhooks`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `test`: Tests
- `refactor`: Code refactoring
- `chore`: Maintenance

## Questions?

Open an issue or contact the maintainers.
