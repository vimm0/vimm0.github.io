---
layout: post
title: "Graphql-voyager on graphene-django"
date: 2021-10-14 01:02:36 +0545
categories: django
---
If you want to "graphql-voyager" on  "graphene_django", you should override template in "graphene_django/templates/graphene/graphiql.html"

{% raw %}
<!--
The request to this GraphQL server provided the header "Accept: text/html"
and as a result has been presented GraphiQL - an in-browser IDE for
exploring GraphQL.
If you wish to receive JSON, provide the header "Accept: application/json" or
add "&raw" to the end of the URL within a browser.
-->
{% load static %}
<!DOCTYPE html>
<html>
<head>
    <title>GraphiQL</title>
    <style>
        html,
        body,
        #editor {
            height: 100%;
            width: 100%;
            margin: 0;
        }
    </style>
  <style>
        body {
            height: 100%;
            margin: 0;
            width: 100%;
            overflow: hidden;
        }

        #voyager {
            height: 100vh;
        }
    </style>
    <link
            href="https://cdn.jsdelivr.net/npm/graphiql-with-extensions@0.14.3/graphiqlWithExtensions.css"
            rel="stylesheet"
    />
     <!--
      This GraphQL Voyager example depends on Promise and fetch, which are available in
      modern browsers, but can be "polyfilled" for older browsers.
      GraphQL Voyager itself depends on React DOM.
      If you do not want to rely on a CDN, you can host these files locally or
      include them directly in your favored resource bunder.
    -->
    <script src="https://cdn.jsdelivr.net/es6-promise/4.0.5/es6-promise.auto.min.js"></script>
    <script src="https://cdn.jsdelivr.net/fetch/0.9.0/fetch.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/react@16/umd/react.production.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/react-dom@16/umd/react-dom.production.min.js"></script>

    <!--
      These two files are served from jsDelivr CDN, however you may wish to
      copy them directly into your environment, or perhaps include them in your
      favored resource bundler.
     -->
    <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/graphql-voyager/dist/voyager.css"
    />
    <script src="https://cdn.jsdelivr.net/npm/graphql-voyager/dist/voyager.min.js"></script>
</head>

<body>
<!--<div id="editor"></div>-->
<div id="voyager">Loading...</div>

<script src="https://cdn.jsdelivr.net/npm/whatwg-fetch@3.6.2/dist/fetch.umd.js"
        integrity="sha256-+pQdxwAcHJdQ3e/9S4RK6g8ZkwdMgFQuHvLuN5uyk5c=" crossorigin="anonymous"></script>
<script
        src="https://cdn.jsdelivr.net/npm/react@{{react_version}}/umd/react.production.min.js"
        integrity="{{react_sri}}"
        crossorigin="anonymous"
></script>
<script
        src="https://cdn.jsdelivr.net/npm/react-dom@{{react_version}}/umd/react-dom.production.min.js"
        integrity="{{react_dom_sri}}"
        crossorigin="anonymous"
></script>
<script src="https://cdn.jsdelivr.net/npm/graphiql-with-extensions@0.14/graphiqlWithExtensions.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/js-cookie@rc/dist/js.cookie.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/subscriptions-transport-ws@0.9.19/browser/client.js"
        integrity="sha256-BKMbTbqUpeRuFBA9qYWYe8TGy2uBpCoxnJPX1n8Vxo4=" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/graphiql-subscriptions-fetcher@0.0.2/browser/client.js"></script>
<script>
    function httpUrlToWebSockeUrl(url) {
        return url.replace(/(http)(s)?\:\/\//, "ws$2://");
    }

    function graphQLFetcher(graphQLParams) {
        let headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
        };

        let csrfToken = Cookies.get("csrftoken");
        if (csrfToken) {
            headers["x-csrftoken"] = csrfToken;
        }

        return fetch(window.location.href, {
            method: "post",
            headers: headers,
            body: JSON.stringify(graphQLParams),
        })
            .then((response) => {
                return response.text();
            })
            .then((responseBody) => {
                try {
                    return JSON.parse(responseBody);
                } catch (error) {
                    return responseBody;
                }
            });
    }
    // Defines a GraphQL introspection fetcher using the fetch API. You're not required to
    // use fetch, and could instead implement introspectionProvider however you like,
    // as long as it returns a Promise
    // Voyager passes introspectionQuery as an argument for this function
    function introspectionProvider(introspectionQuery) {
        // This example expects a GraphQL server at the path /graphql.
        // Change this to point wherever you host your GraphQL server.
        let headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
        };

        let csrfToken = Cookies.get("csrftoken");
        if (csrfToken) {
            headers["x-csrftoken"] = csrfToken;
        }
        return fetch(window.location.href, {
            method: 'post',
            headers: headers,
            body: JSON.stringify({query: introspectionQuery}),
            credentials: 'include',
        })
            .then(function (response) {
                return response.text();
            })
            .then(function (responseBody) {
                try {
                    return JSON.parse(responseBody);
                } catch (error) {
                    return responseBody;
                }
            });
    }
    const subscriptionsClient =
        "{{subscription_path}}" != "None" && "{{subscription_path}}" != ""
            ? new window.SubscriptionsTransportWs.SubscriptionClient(
            httpUrlToWebSockeUrl("{{subscription_path}}"),
            {
                reconnect: true,
            }
            )
            : null;

    const graphQLFetcherWithSubscriptions =
        window.GraphiQLSubscriptionsFetcher.graphQLFetcher(
            subscriptionsClient,
            graphQLFetcher
        );
 // Render <Voyager /> into the body.
    GraphQLVoyager.init(document.getElementById('voyager'), {
        introspection: introspectionProvider,
    });
    ReactDOM.render(
        React.createElement(GraphiQLWithExtensions.GraphiQLWithExtensions, {
            fetcher: graphQLFetcherWithSubscriptions,
            headerEditorEnabled: "{{graphiql_header_editor_enabled}}" == "True",
        }),
        document.getElementById("editor")
    );
</script>
</body>
</html>

{% endraw %}

Sources from Graphene Django Issues:

 - [Add GraphiQL Explorer #1204](https://github.com/graphql-python/graphene-django/issues/1204)
 - [How can I integrate with GraphiQL explorer and GraphQL Voyager?  #834](https://github.com/graphql-python/graphene-django/issues/834)
 - [Graphql Voyager Full Source](https://github.com/APIs-guru/graphql-voyager/blob/master/example/index.html)