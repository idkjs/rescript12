#!/usr/bin/env node
/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, $$BLACKLIST, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const $$BLACKLIST = null;
const ignorePattern = $$BLACKLIST ? new RegExp($$BLACKLIST) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}/;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![A-Za-z]:)(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["bs-platform",
new Map([["8.4.2",
         {
           packageLocation: "/Volumes/SSD/.esy/source/i/bs_platform__8.4.2__fb39b1d1/",
           packageDependencies: new Map([["bs-platform", "8.4.2"]])}]])],
  ["debug",
  new Map([["2.6.9",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/debug__2.6.9__8eaf8f1e/",
             packageDependencies: new Map([["debug", "2.6.9"],
                                             ["ms", "2.0.0"]])}]])],
  ["depd",
  new Map([["1.1.2",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/depd__1.1.2__5a587264/",
             packageDependencies: new Map([["depd", "1.1.2"]])}]])],
  ["destroy",
  new Map([["1.0.4",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/destroy__1.0.4__5d62f2a6/",
             packageDependencies: new Map([["destroy", "1.0.4"]])}]])],
  ["ee-first",
  new Map([["1.1.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/ee_first__1.1.1__ab35044e/",
             packageDependencies: new Map([["ee-first", "1.1.1"]])}]])],
  ["encodeurl",
  new Map([["1.0.2",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/encodeurl__1.0.2__dcc1af85/",
             packageDependencies: new Map([["encodeurl", "1.0.2"]])}]])],
  ["escape-html",
  new Map([["1.0.3",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/escape_html__1.0.3__89c8e646/",
             packageDependencies: new Map([["escape-html", "1.0.3"]])}]])],
  ["etag",
  new Map([["1.8.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/etag__1.8.1__9339258c/",
             packageDependencies: new Map([["etag", "1.8.1"]])}]])],
  ["fresh",
  new Map([["0.5.2",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/fresh__0.5.2__c27d9c34/",
             packageDependencies: new Map([["fresh", "0.5.2"]])}]])],
  ["http-errors",
  new Map([["1.7.3",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/http_errors__1.7.3__3cd84fd5/",
             packageDependencies: new Map([["depd", "1.1.2"],
                                             ["http-errors", "1.7.3"],
                                             ["inherits", "2.0.4"],
                                             ["setprototypeof", "1.1.1"],
                                             ["statuses", "1.5.0"],
                                             ["toidentifier", "1.0.0"]])}]])],
  ["inherits",
  new Map([["2.0.4",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/inherits__2.0.4__5ce658b5/",
             packageDependencies: new Map([["inherits", "2.0.4"]])}]])],
  ["js-tokens",
  new Map([["4.0.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/js_tokens__4.0.0__13c348c2/",
             packageDependencies: new Map([["js-tokens", "4.0.0"]])}]])],
  ["loose-envify",
  new Map([["1.4.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/loose_envify__1.4.0__f4d87f47/",
             packageDependencies: new Map([["js-tokens", "4.0.0"],
                                             ["loose-envify", "1.4.0"]])}]])],
  ["mime",
  new Map([["1.6.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/mime__1.6.0__34cfdcf1/",
             packageDependencies: new Map([["mime", "1.6.0"]])}]])],
  ["moduleserve",
  new Map([["0.9.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/moduleserve__0.9.1__455d358d/",
             packageDependencies: new Map([["moduleserve", "0.9.1"],
                                             ["send", "0.17.1"],
                                             ["serve-static", "1.14.1"]])}]])],
  ["ms",
  new Map([["2.0.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/ms__2.0.0__d842b4cd/",
             packageDependencies: new Map([["ms", "2.0.0"]])}],
             ["2.1.1",
             {
               packageLocation: "/Volumes/SSD/.esy/source/i/ms__2.1.1__21431ecb/",
               packageDependencies: new Map([["ms", "2.1.1"]])}]])],
  ["object-assign",
  new Map([["4.1.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/object_assign__4.1.1__c3b8f00e/",
             packageDependencies: new Map([["object-assign", "4.1.1"]])}]])],
  ["on-finished",
  new Map([["2.3.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/on_finished__2.3.0__82731177/",
             packageDependencies: new Map([["ee-first", "1.1.1"],
                                             ["on-finished", "2.3.0"]])}]])],
  ["parseurl",
  new Map([["1.3.3",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/parseurl__1.3.3__256f617c/",
             packageDependencies: new Map([["parseurl", "1.3.3"]])}]])],
  ["prop-types",
  new Map([["15.7.2",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/prop_types__15.7.2__7d0cd738/",
             packageDependencies: new Map([["loose-envify", "1.4.0"],
                                             ["object-assign", "4.1.1"],
                                             ["prop-types", "15.7.2"],
                                             ["react-is", "16.13.1"]])}]])],
  ["range-parser",
  new Map([["1.2.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/range_parser__1.2.1__bbb82e6e/",
             packageDependencies: new Map([["range-parser", "1.2.1"]])}]])],
  ["react",
  new Map([["16.14.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/react__16.14.0__ccc04f20/",
             packageDependencies: new Map([["loose-envify", "1.4.0"],
                                             ["object-assign", "4.1.1"],
                                             ["prop-types", "15.7.2"],
                                             ["react", "16.14.0"]])}]])],
  ["react-dom",
  new Map([["16.14.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/react_dom__16.14.0__27c5fac7/",
             packageDependencies: new Map([["loose-envify", "1.4.0"],
                                             ["object-assign", "4.1.1"],
                                             ["prop-types", "15.7.2"],
                                             ["react", "16.14.0"],
                                             ["react-dom", "16.14.0"],
                                             ["scheduler", "0.19.1"]])}]])],
  ["react-is",
  new Map([["16.13.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/react_is__16.13.1__8a41bdd9/",
             packageDependencies: new Map([["react-is", "16.13.1"]])}]])],
  ["reason-react",
  new Map([["0.9.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/reason_react__0.9.1__d0ebedb2/",
             packageDependencies: new Map([["react", "16.14.0"],
                                             ["react-dom", "16.14.0"],
                                             ["reason-react", "0.9.1"]])}]])],
  ["scheduler",
  new Map([["0.19.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/scheduler__0.19.1__f23c7769/",
             packageDependencies: new Map([["loose-envify", "1.4.0"],
                                             ["object-assign", "4.1.1"],
                                             ["scheduler", "0.19.1"]])}]])],
  ["send",
  new Map([["0.17.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/send__0.17.1__dd5ceb60/",
             packageDependencies: new Map([["debug", "2.6.9"],
                                             ["depd", "1.1.2"],
                                             ["destroy", "1.0.4"],
                                             ["encodeurl", "1.0.2"],
                                             ["escape-html", "1.0.3"],
                                             ["etag", "1.8.1"],
                                             ["fresh", "0.5.2"],
                                             ["http-errors", "1.7.3"],
                                             ["mime", "1.6.0"],
                                             ["ms", "2.1.1"],
                                             ["on-finished", "2.3.0"],
                                             ["range-parser", "1.2.1"],
                                             ["send", "0.17.1"],
                                             ["statuses", "1.5.0"]])}]])],
  ["serve-static",
  new Map([["1.14.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/serve_static__1.14.1__31eb8270/",
             packageDependencies: new Map([["encodeurl", "1.0.2"],
                                             ["escape-html", "1.0.3"],
                                             ["parseurl", "1.3.3"],
                                             ["send", "0.17.1"],
                                             ["serve-static", "1.14.1"]])}]])],
  ["setprototypeof",
  new Map([["1.1.1",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/setprototypeof__1.1.1__c9b41210/",
             packageDependencies: new Map([["setprototypeof", "1.1.1"]])}]])],
  ["statuses",
  new Map([["1.5.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/statuses__1.5.0__d1e84300/",
             packageDependencies: new Map([["statuses", "1.5.0"]])}]])],
  ["toidentifier",
  new Map([["1.0.0",
           {
             packageLocation: "/Volumes/SSD/.esy/source/i/toidentifier__1.0.0__a81aee68/",
             packageDependencies: new Map([["toidentifier", "1.0.0"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/Volumes/SSD/Github/rescript12/",
             packageDependencies: new Map([["bs-platform", "8.4.2"],
                                             ["moduleserve", "0.9.1"],
                                             ["react", "16.14.0"],
                                             ["react-dom", "16.14.0"],
                                             ["reason-react", "0.9.1"]])}]])]]);

let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../../.esy/source/i/bs_platform__8.4.2__fb39b1d1/",
  {
    name: "bs-platform",
    reference: "8.4.2"}],
  ["../../../../.esy/source/i/debug__2.6.9__8eaf8f1e/",
  {
    name: "debug",
    reference: "2.6.9"}],
  ["../../../../.esy/source/i/depd__1.1.2__5a587264/",
  {
    name: "depd",
    reference: "1.1.2"}],
  ["../../../../.esy/source/i/destroy__1.0.4__5d62f2a6/",
  {
    name: "destroy",
    reference: "1.0.4"}],
  ["../../../../.esy/source/i/ee_first__1.1.1__ab35044e/",
  {
    name: "ee-first",
    reference: "1.1.1"}],
  ["../../../../.esy/source/i/encodeurl__1.0.2__dcc1af85/",
  {
    name: "encodeurl",
    reference: "1.0.2"}],
  ["../../../../.esy/source/i/escape_html__1.0.3__89c8e646/",
  {
    name: "escape-html",
    reference: "1.0.3"}],
  ["../../../../.esy/source/i/etag__1.8.1__9339258c/",
  {
    name: "etag",
    reference: "1.8.1"}],
  ["../../../../.esy/source/i/fresh__0.5.2__c27d9c34/",
  {
    name: "fresh",
    reference: "0.5.2"}],
  ["../../../../.esy/source/i/http_errors__1.7.3__3cd84fd5/",
  {
    name: "http-errors",
    reference: "1.7.3"}],
  ["../../../../.esy/source/i/inherits__2.0.4__5ce658b5/",
  {
    name: "inherits",
    reference: "2.0.4"}],
  ["../../../../.esy/source/i/js_tokens__4.0.0__13c348c2/",
  {
    name: "js-tokens",
    reference: "4.0.0"}],
  ["../../../../.esy/source/i/loose_envify__1.4.0__f4d87f47/",
  {
    name: "loose-envify",
    reference: "1.4.0"}],
  ["../../../../.esy/source/i/mime__1.6.0__34cfdcf1/",
  {
    name: "mime",
    reference: "1.6.0"}],
  ["../../../../.esy/source/i/moduleserve__0.9.1__455d358d/",
  {
    name: "moduleserve",
    reference: "0.9.1"}],
  ["../../../../.esy/source/i/ms__2.0.0__d842b4cd/",
  {
    name: "ms",
    reference: "2.0.0"}],
  ["../../../../.esy/source/i/ms__2.1.1__21431ecb/",
  {
    name: "ms",
    reference: "2.1.1"}],
  ["../../../../.esy/source/i/object_assign__4.1.1__c3b8f00e/",
  {
    name: "object-assign",
    reference: "4.1.1"}],
  ["../../../../.esy/source/i/on_finished__2.3.0__82731177/",
  {
    name: "on-finished",
    reference: "2.3.0"}],
  ["../../../../.esy/source/i/parseurl__1.3.3__256f617c/",
  {
    name: "parseurl",
    reference: "1.3.3"}],
  ["../../../../.esy/source/i/prop_types__15.7.2__7d0cd738/",
  {
    name: "prop-types",
    reference: "15.7.2"}],
  ["../../../../.esy/source/i/range_parser__1.2.1__bbb82e6e/",
  {
    name: "range-parser",
    reference: "1.2.1"}],
  ["../../../../.esy/source/i/react__16.14.0__ccc04f20/",
  {
    name: "react",
    reference: "16.14.0"}],
  ["../../../../.esy/source/i/react_dom__16.14.0__27c5fac7/",
  {
    name: "react-dom",
    reference: "16.14.0"}],
  ["../../../../.esy/source/i/react_is__16.13.1__8a41bdd9/",
  {
    name: "react-is",
    reference: "16.13.1"}],
  ["../../../../.esy/source/i/reason_react__0.9.1__d0ebedb2/",
  {
    name: "reason-react",
    reference: "0.9.1"}],
  ["../../../../.esy/source/i/scheduler__0.19.1__f23c7769/",
  {
    name: "scheduler",
    reference: "0.19.1"}],
  ["../../../../.esy/source/i/send__0.17.1__dd5ceb60/",
  {
    name: "send",
    reference: "0.17.1"}],
  ["../../../../.esy/source/i/serve_static__1.14.1__31eb8270/",
  {
    name: "serve-static",
    reference: "1.14.1"}],
  ["../../../../.esy/source/i/setprototypeof__1.1.1__c9b41210/",
  {
    name: "setprototypeof",
    reference: "1.1.1"}],
  ["../../../../.esy/source/i/statuses__1.5.0__d1e84300/",
  {
    name: "statuses",
    reference: "1.5.0"}],
  ["../../../../.esy/source/i/toidentifier__1.0.0__a81aee68/",
  {
    name: "toidentifier",
    reference: "1.0.0"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 58 && relativeLocation[57] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 58)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 57 && relativeLocation[56] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 57)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 56 && relativeLocation[55] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 56)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 55 && relativeLocation[54] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 55)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 54 && relativeLocation[53] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 54)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 53 && relativeLocation[52] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 53)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 52 && relativeLocation[51] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 52)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 51 && relativeLocation[50] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 51)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 49 && relativeLocation[48] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 49)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 48 && relativeLocation[47] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 48)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 46 && relativeLocation[45] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 46)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

    return null;
  };
  

/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "$$BLACKLIST")`,
        {
          request,
          issuer
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {extensions});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath);
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    const issuerModule = getIssuerModule(parent);
    const issuer = issuerModule ? issuerModule.filename : process.cwd() + '/';

    const resolution = exports.resolveRequest(request, issuer);
    return resolution !== null ? resolution : request;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);

  if (process.env.ESY__NODE_BIN_PATH != null) {
    const delimiter = require('path').delimiter;
    process.env.PATH = `${process.env.ESY__NODE_BIN_PATH}${delimiter}${process.env.PATH}`;
  }
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        }
      }
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
