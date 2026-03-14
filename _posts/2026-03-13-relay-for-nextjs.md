---
layout: post
title: "Relay for Next.js: Complete Guide to Modern GraphQL Data Fetching"
date:   2026-03-13 00:00:00 +0700
categories: graphql nextjs relay javascript
tags: [graphql, next.js, react, oss]
---

**Relay for Next.js** represents a significant evolution in how we approach data fetching with GraphQL. While traditional Apollo Client has dominated the React ecosystem, Facebook's Relay brought powerful type safety and query optimization features that are now accessible through modern tooling like [`relay-hooks`](https://www.npmjs.com/package/relay-hooks) and [`react-relay-hooks`](https://github.com/dotansimha/react-relay).

In this comprehensive guide, I'll explain what makes Relay special for Next.js applications, show you how to set it up, and demonstrate practical patterns that leverage Relay's query optimization capabilities.

## What Is Relay?

Relay is an end-to-end framework developed by Facebook that treats GraphQL queries as **first-class citizens** in your application. Unlike Apollo, which focuses on generic data fetching, Relay emphasizes:

- **Query planning**: Smart caching and deduplication based on query shapes
- **Type safety**: Compile-time checks prevent invalid field selections
- **Diffed updates**: Efficient UI updates only for changed fields
- **Fragment composition**: Declarative component-based query building

### Apollo vs. Relay Comparison

| Feature | Apollo Client | Relay Modern |
|---------|---------------|--------------|
| Query language | GraphQL (JavaScript) | GraphQL (typeScript + fragment types) |
| Type safety | Runtime checks | Compile-time TypeScript integration |
| Caching | Manual store configuration | Automatic query planning engine |
| Code splitting | Bundle-time analysis | Fragment-based routing |
| Field-level diffing | Basic optimistic UI | Advanced field delta updates |

## Why Relay for Next.js?

Next.js applications face unique data fetching challenges, especially in **Server Components** and **ISR (Incremental Static Regeneration)** scenarios. Relay addresses several pain points:

1. **Reduced bundle size**: Query splitting eliminates unused GraphQL fragments
2. **Better cache efficiency**: Shape-based caching reduces redundant requests
3. **Declarative updates**: Fragments make UI updates predictable
4. **SSG-friendly**: Works seamlessly with Next.js static generation

## Prerequisites

Before diving in, ensure you have:

```bash
# Node 18+ required
node --version

# Create a new Next.js project (if needed)
npx create-next-app@latest my-relay-app --typescript

cd my-relay-app
```

## Installation

Relay integration in Next.js is simpler than ever with the `react-relay-hooks` package. Start by installing the necessary packages:

```bash
npm install react-relay-hooks @apollo/client graphql
# Or with yarn
yarn add react-relay-hooks @apollo/client graphql
```

The setup leverages Apollo Client as the underlying GraphQL client while adding Relay-like conveniences on top.

## Basic Setup

### 1. Initialize Relay Environment

Create your first `relayEnvironment` instance that Apollo Client can use:

```typescript
// lib/relay.ts
import {
  graphql,
  graphqlWithDefaults,
} from 'react-relay-hooks';

export function makeRelayEnvironment() {
  return createEnvironment({
    endpoint: process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT!,
    fetcher: async (url, variables) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: url, variables }),
      });

      const data: ResponseData = await res.json();

      // Relay expects a different response shape
      return {
        errors: data.errors,
        data: data.data,
        extensions: data.extensions,
      };
    },
  });
}

export { graphql, graphqlWithDefaults };
```

### 2. Create Type Definitions with `generate-types-graphql`

Relay's power comes from **introspection-based type generation**. First, extract your GraphQL schema and codegen it:

```json
// next.config.js
module.exports = {
  webpack: (config) => {
    config.resolve.fallback = { fs: false }
    return config
  },
  async rewrites() {
    return []
  }
}
```

Run the code generation command after extracting your schema (see below):

```bash
npm install graphql-codegen @graphql-codegen/import-types-preset @graphql-codegen/typescript @graphql-codegen/typescript-operations
# Generate fragments and operations from your GraphQL schema
npx graphql-codegen --config codegen.yml
```

## Your First Query

### Define Types in TypeScript

Start by defining fragment types for your data:

```typescript
// src/fragments/index.ts
import { makeFragmentGraphql } from 'react-relay-hooks'

export const userFeedFragment = makeFragmentGraphQL<{
  __typename: 'User'
  id: string
  displayName: string | null
}>`
  fragment on User @connection(key: "userFeed") {
    id
    displayName
  }
`;
```

### Use Fragment in Components

Relay fragments are component-level, making them feel natural in React:

```typescript
// src/user-feed.tsx
'use client' // Next.js client directive

import useQuery from './relay';
import { userFeedFragment } from './fragments';

const UserFeed: React.FC = () => {
  const result = useQuery(userFeedFragment);

  return (
    <div className="p-4">
      {result.data?.users.map((user) => (
        <div key={user.id} className="m-2 border p-3 rounded">
          <strong>{user.displayName}</strong>
        </div>
      ))}
      
      {!result.loading && result.error && (
        <p>Error: {result.error.message}</p>
      )}
    </div>
  );
};

export default UserFeed;
```

## Advanced Patterns

### 1. Nested Fragments for Data Relationships

Relay excels at composing fragmented queries across parent-child relationships:

```typescript
// src/fragments/post.tsx
import { makeFragmentGraphql } from 'react-relay-hooks'

export const postContentFragment = makeFragmentGraphql<{
  __typename: 'Post'
  id: string
  title: string | null
} & {
  author?: {
    __fragmentRef: typeof userFeedFragment;
  };
}>`
  fragment on Post @connection(key: "postContent") {
    id
    title
    
    # Include related user via fragment reference
    ...userFeed
  }
`;
```

### 2. Query Caching with Next.js ISR

Relay's automatic caching plays nicely with Next.js revalidation patterns:

```typescript
// src/articles.tsx - Server Component
import { graphql, useLazyLoadQuery } from 'relly';

const articles = graphql`
  query ArticlesByDateQuery($date: ISODateTime!) {
    feed(date: $date) {
      posts(first: 10, sort: CREATED_AT_DESC) {
        edges {
          node {
            id
            title
            date
          }
        }
      }
    }
  }
`;

export default function ArticleList() {
  const [data, loading] = useLazyLoadQuery<{
    feed: {
      posts: { edges: Array<{ node: { id: string; title: string; date: string } }> }
    };
  }>({
    date: new Date().toISOString(),
  });

  return (
    <div>
      {loading && <p>Loading...</p>}
      {!loading && data.feed.posts.edges.map((edge) => (
        <article 
          key={edge.node.id}        
          className="mb-6"
          dangerouslySetInnerHTML={{ __html: edge.node.title }},
        />
      ))}
    </div>
  );
}
```

### 3. Optimistic Updates with `relay-hooks`

Relay's optimistic UI is built-in for mutation handling:

```typescript
// src/mutations.tsx
import { commitMutation } from 'react-relay-hooks';
import type { FeedCreateCommitMutationResponse, FeedCreateCommitMutationVariables } from './__generated__/FeedCreate_commit';
import { feedCreateMutation } from './mutations/feed_create';

const createPost = async (title: string) => {
  // Optimistically show the new post immediately
  
  const variables: FeedCreateCommitMutationVariables = {
    title,
  };

  await commitMutation<FeedCreateCommitMutation>(window.relayEnvironment!, {
    mutation: feedCreateMutation,
    variables,
  });
};
```

### 4. Dynamic Queries for API Routes

Integrate Relay patterns with Next.js API routes or RSC (React Server Components):

```typescript
// app/graphql/route.ts - Custom GraphQL endpoint
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const variables = body.variables;
  const query = body.query;

  try {
    const result = await fetch(process.env.API_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    return new Response(await result.text(), { status: result.status });  
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });  
  }
}
```

## Schema Code Generation

To get the best type safety from Relay, extract and codegen your GraphQL schema:

### 1. Extract Schema with `introspect`

```typescript
// scripts/extract-schema.ts
import { introspectionFromSchema, buildClientSchema, parse, print } from '@whatwg-node/fetch';

export async function extractGraphqlApiEndpoint(endpoint: string): Promise<any> {
  const response = await fetch(`${endpoint}.introspection.json`); 
  const schemaJson: GraphqlIntrospectionQueryResponse = await response.json();  
  return buildClientSchema(schemaJson);
}
```

### 2. Generate TypeScript Types

Create a `codegen.yml` file for your codegen setup:

```yaml
# codegen.yml
schema: http://localhost:4001/graphql
generates:
  src/__generated__/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
      - typescript-resolvers
    config:
      withHooksConfig:
        mode: relay-hooks
```

Run codegen to produce type files:

```bash
npm install @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/relay
npm install --save-dev graphql-request @envelop/introspection
npx graphql-codegen
```

The generated files will include `__generated__/Post.ts`, `__generated__/Feed.ts`, and related hooks.

## Configuration for Production

### Environment Variables

Define your GraphQL endpoint in a production environment:

```bash
# .env.local
NEXT_PUBLIC_GRAPHQL_ENDPOINT=https://your-api.com/graphql

# For SSR/API routes
GRAPHQL_ENDPOINT=http://localhost:4000/graphql
API_KEY=your-api-key
```

Load them appropriately in your Next.js app with the `next.config.js`:

```javascript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/graphql',
        destination: 'http://your-upstream-graphql-service/graphql',
      },
    ];
  },
};
```

### Webpack Optimization for GraphQL Bundling

To optimize bundle size in production Next.js builds:

```javascript
// next.config.js
const withRelay = require('next-relay');

module.exports = withRelay({
  // ...
});
```

## Common Patterns & Gotchas

### Handling Multiple GraphQl Endpoints

In Next.js, you often need to work across multiple GraphQL backends. Create a unified fetcher function:

```typescript
// lib/relay-unified.ts
import { makeRelayEnvironment, environment } from 'react-relay-hooks';

export default environment;

export const createFederatedGraphQLClient = (): Environment => {
  return new Client({ endpoint: '/api/graphql' });
};
```

### Testing Relay Hooks with Jest/Vitest

Test your fragments and queries with integration tests:

```typescript
// tests/relay.test.tsx (Vitest)
import { graphql } from 'relly';
import renderHook from '@testing-library/react-hooks';

const query = graphql`
  query testQuery {
    feed {
      posts {
        id
        title
      }
    }
  }
`;

describe('GraphQL Relay Hooks Integration', () => {
  it('returns posts correctly', async () => {
    const result = renderHook(() => useQuery(query));
    
    expect(result.current.data).toEqual({ feed: { posts: [] } });  
  });
});
```

### Error Handling Best Practices

Always handle GraphQL errors appropriately:

```typescript
function PostList() {
  const [result, loading, error] = useLazyLoadQuery<PostListData>(QUERY) as [PostListData, boolean, RelayError];

  if (loading) return <Spinner />;

  if (error) {
    // Log to monitoring service like Sentry
    Sentry.captureException(error);
    return <ErrorMessage message={error.message} />;  
  }

  return ...;
}
```

## Migration Path from Apollo

If you're migrating from Apollo Client to Relay:

### Step 1: Set up Type Definitions

Instead of runtime-generated fragments, start with TypeScript-only fragments.

### Step 2: Fragment-by-Fragment Conversion

Migrate queries incrementally—convert one fragment at a time:

```typescript
// Before (Apollo)
useQuery(gql`query { posts { ...PostFields } }`)

// After (Relay)
const query = graphql`
  query PostsQuery {
    posts {
      id
      title
      content @include(if: $showContent)
      ... on Post {
        author {
          name
        }
      }
    }
  }
`;
useLazyLoadQuery(query({}));
```

### Step 3: Refactor Store Calls

Relay's store is automatically wired when you commit mutations, so `store` calls become implicit after conversion.

## Performance Optimization

### Query Deduplication

Relay automatically deduplicates identical queries at the edge and on client-side rendering. This reduces redundant requests by up to 50% in many apps:

```typescript
// In your component tree, identical fragments share cache:
const Fragment1 = graphql`
  fragment PostOnFeed on Post {
    id
    title
  }
`;

const Fragment2 = graphql`
  fragment PostOnFeed on Post {
    id
    title
  }
`;
// These are the same shape → Relay merges them
```

### Lazy Loading for Server Components

With Next.js App Router, defer non-critical loads to improve TTI (Time to Interactive):

```typescript
// In your layout file  
const Posts = () => {
  const [posts] = useLazyLoadQuery<PostsData>(POSTS_QUERY, {});

  return (
    <Fragment>
      {/* Critical: visible immediately */}
      <Hero />
      
      {/* Non-critical: lazy loaded */}
      <Suspense fallback={<Spinner />}>
        <PostsContent posts={posts} />
      </Suspense>
    </Fragment>
  );
};
```

## Monitoring and Observability

### Track Relay Metrics

Monitor query performance in production:

```typescript
import { commitMutation } from 'react-relay-hooks';

const mutation = graphql`
  mutation UserLoginMutation($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      user {
        id
      }
    }
  }
`;

await commitMutation(window.relayEnvironment!, {
  mutation,
  variables,
  onCommit: (result) => {
    // Log to CloudWatch/Datadog/Sentry  
    logger.info('Login completed successfully', {
      traceId,
      userId: result.user.id,
    });
  },
});
```

## Real-World Use Cases

### 1. Social Media Feed with Infinite Scroll

Relay's incremental loading works perfectly for infinite scrolling feeds. When users scroll to fetch more content, Relay efficiently queries only what changed:

```typescript
// app/infinite-feed.tsx
const feedQuery = graphql`
  query InfiniteFeedQuery($offset: Int!) {
    feed(first: 10, offset: $offset) {
      nodes {
        id
        title
        author {
          username
        }
      }
    }
  }
`;

export default function Feed() {
  const fetchMore = useLoadableQuery(feedQuery);
  
  return (
    <div>
      {fetchMore.data?.feed.nodes.map(node => (
        <Article key={node.id} data={node} />
      ))}
      {!loading && (
        <button onClick={() => fetchMore({ offset: lastOffset + feedPage.size })}>
          Load More
        </button>
      )}
    </div>
  );
}
```

### 2. Dashboard with Real-time Updates

For dashboards that need real-time data updates, use Relay's optimistic UI capabilities:

```typescript
// app/dashboard.tsx
export const DASHBOARDACTION_QUERY = graphql`
  query DashboarDACTIonQuery {
    dashboard {
      users {
        id
        name
        status
      }
    }
  }
`;
```

### 3. E-commerce Cart with Optimistic Updates

Relay's optimistic updates make cart modifications instant:

```typescript
export const ADD_ITEM_TO_CART_MUTATION = graphql`
  mutation AddItemToCartMutation($productId: ID!) {
    addItemToCart(productId: $productId) {
      item {
        quantity
        price
      }
    }
  }
`;
```

## Best Practices Summary

1. **Start simple**: Use fragments from the beginning instead of monolithic queries
2. **Codegen consistently**: Always generate types with `graphql-codegen`  
3. **Lazy load strategically**: In Next.js ISR, only load queries critical to render above-the-fold content server-side
4. **Error boundary strategy**: Wrap your Relay components in an error boundary for better UX
5. **Document fragments**: Add inline comments to help teammates understand query shape relationships

## Conclusion

Relay's integration with Next.js brings powerful GraphQL patterns to modern React applications. While there's a learning curve compared to Apollo, the benefits of query planning, field-level diffing, and automatic type safety make it worth adopting for new projects or gradual migration.

The key takeaway: **Start small**. Integrate fragment-by-fragment, codegen your schema early, and gradually adopt Relay patterns in your Next.js app. By following best practices around ISR and optimistic UI, you'll build performant, maintainable applications with GraphQL as a first-class citizen.

---

## Further Reading

- [Relay Modern docs](https://www.devrel.fb.com/)
- [GraphQL Code Generator](https://the-guild.dev/graphql/codegen)
- [Next.js React Server Components with GraphQL](https://nextjs.org/docs/basic-features/data-fetching/server-components-graphql)
- [Apollo vs Relay comparison](https://dev.to/abhishekdubey154/apoll-vs-relay-a-comprehensive-comparison-3h0l)

For questions, check out our community Discord channel or open an issue in the codebase. Happy querying! 🚀
