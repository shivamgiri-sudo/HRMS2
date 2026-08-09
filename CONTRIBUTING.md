# Contributing to CoreHR Hub

Thank you for your interest in contributing to CoreHR Hub! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Please:

- Be respectful and constructive in discussions
- Welcome newcomers and help them get started
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Git
- A Supabase account (free tier works)
- Basic knowledge of React, TypeScript, and Tailwind CSS

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/corehr-hub.git
   cd corehr-hub
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/corehr-hub.git
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

## Development Workflow

### Branching Strategy

We use a feature branch workflow:

- `main` - Production-ready code
- `develop` - Integration branch for features (if applicable)
- `feature/*` - New features (e.g., `feature/add-employee-export`)
- `fix/*` - Bug fixes (e.g., `fix/leave-calculation-error`)
- `docs/*` - Documentation updates

### Creating a Feature Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create your feature branch
git checkout -b feature/your-feature-name
```

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Define proper types/interfaces - avoid `any`
- Use type inference where obvious
- Export types from dedicated files when shared

```typescript
// ✅ Good
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

const getFullName = (employee: Employee): string => {
  return `${employee.firstName} ${employee.lastName}`;
};

// ❌ Avoid
const getFullName = (employee: any) => {
  return employee.firstName + ' ' + employee.lastName;
};
```

### React Components

- Use functional components with hooks
- Keep components focused and small (under 200 lines ideally)
- Extract reusable logic into custom hooks
- Use proper prop typing

```typescript
// ✅ Good - Typed props, focused component
interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (id: string) => void;
}

export const EmployeeCard = ({ employee, onEdit }: EmployeeCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{employee.firstName} {employee.lastName}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{employee.email}</p>
        {onEdit && (
          <Button onClick={() => onEdit(employee.id)}>Edit</Button>
        )}
      </CardContent>
    </Card>
  );
};
```

### Tailwind CSS & Styling

- **Use design system tokens** - never use direct colors
- Use semantic class names from the design system
- Keep responsive design in mind (`sm:`, `md:`, `lg:` prefixes)
- Use shadcn/ui components as the foundation

```tsx
// ✅ Good - Using design tokens
<div className="bg-background text-foreground border-border">
  <Button variant="primary">Submit</Button>
</div>

// ❌ Avoid - Direct colors
<div className="bg-white text-black border-gray-200">
  <button className="bg-blue-500">Submit</button>
</div>
```

### File Organization

```
src/
├── components/
│   ├── ui/              # shadcn/ui base components
│   ├── employees/       # Feature-specific components
│   └── layout/          # Layout components
├── hooks/               # Custom React hooks
├── pages/               # Page components
├── contexts/            # React contexts
├── lib/                 # Utility functions
└── integrations/        # External service integrations
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `EmployeeCard.tsx` |
| Hooks | camelCase with `use` prefix | `useEmployees.ts` |
| Utilities | camelCase | `formatCurrency.ts` |
| Types/Interfaces | PascalCase | `Employee`, `LeaveRequest` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_FILE_SIZE` |

### Best Practices

1. **Keep components pure** - Avoid side effects in render
2. **Use React Query** for data fetching and caching
3. **Handle loading and error states** properly
4. **Write meaningful variable names** - code should be self-documenting
5. **Avoid prop drilling** - use context or composition
6. **Optimize re-renders** - use `useMemo` and `useCallback` appropriately

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring without feature changes
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

### Examples

```bash
feat(employees): add bulk export functionality

fix(leaves): correct leave balance calculation for part-time employees

docs(readme): update deployment instructions

refactor(payroll): extract salary calculation into separate hook
```

## Pull Request Process

### Before Submitting

1. **Sync with upstream**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run linting and type checks**
   ```bash
   npm run lint
   npm run type-check
   ```

3. **Test your changes** manually in the browser

4. **Self-review your code** - check for:
   - Unused imports or variables
   - Console.log statements
   - Proper error handling
   - Accessibility concerns

### Submitting a PR

1. Push your branch to your fork
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request against the `main` branch

3. Fill out the PR template with:
   - **Description**: What does this PR do?
   - **Related Issues**: Link any related issues
   - **Testing**: How was this tested?
   - **Screenshots**: For UI changes

### PR Review Criteria

Your PR will be reviewed for:

- [ ] Code follows the style guidelines
- [ ] No TypeScript errors or warnings
- [ ] Proper error handling implemented
- [ ] UI is responsive and accessible
- [ ] No breaking changes (or documented if necessary)
- [ ] Performance considerations addressed

### After Review

- Address feedback promptly
- Push fixes as new commits (don't force-push during review)
- Once approved, maintainers will merge your PR

## Issue Guidelines

### Reporting Bugs

Use the bug report template and include:

- **Description**: Clear description of the bug
- **Steps to Reproduce**: Numbered steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: Browser, OS, Node version
- **Screenshots**: If applicable

### Requesting Features

Use the feature request template and include:

- **Problem Statement**: What problem does this solve?
- **Proposed Solution**: How should it work?
- **Alternatives Considered**: Other approaches you've thought of
- **Additional Context**: Mockups, examples, etc.

### Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `priority: high` - Critical issues

## Questions?

If you have questions, feel free to:

- Open a discussion on GitHub
- Comment on relevant issues
- Reach out to maintainers

Thank you for contributing! 🎉
