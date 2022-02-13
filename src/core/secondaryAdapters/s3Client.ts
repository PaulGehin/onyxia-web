import axios from "axios";
import type { ReturnType } from "tsafe";
import { createKeycloakOidcClient } from "./keycloakOidcClient";
import { S3Client } from "../ports/S3Client";
import { getNewlyRequestedOrCachedTokenFactory } from "core/tools/getNewlyRequestedOrCachedToken";
import { id } from "tsafe/id";
import { assert } from "tsafe/assert";
import { Deferred } from "evt/tools/Deferred";
import * as Minio from "minio";
import { parseUrl } from "core/tools/parseUrl";
import memoize from "memoizee";
import type { ApiLogger } from "core/tools/apiLogger";
import { join as pathJoin } from "path";
import type { DeploymentRegion } from "../ports/OnyxiaApiClient";

export type Params = {
    url: string;
    region: string;
    keycloakParams: {
        url: string;
        clientId: string;
        realm: string;
    };
    amazon:
        | {
              roleARN: string;
              roleSessionName: string;
          }
        | undefined;
};

export function getCreateS3ClientParams(params: {
    regionS3: DeploymentRegion.S3;
    fallbackKeycloakParams:
        | {
              url: string;
              clientId: string;
              realm: string;
          }
        | undefined;
}): Params {
    const { regionS3, fallbackKeycloakParams } = params;

    const keycloakParams = (() => {
        const url = regionS3.keycloakParams?.url ?? fallbackKeycloakParams?.url;
        const clientId =
            regionS3.keycloakParams?.clientId ?? fallbackKeycloakParams?.clientId;
        const realm = regionS3.keycloakParams?.realm ?? fallbackKeycloakParams?.realm;

        assert(
            url !== undefined && clientId !== undefined && realm !== undefined,
            "There is no default keycloak config and no specific config for s3",
        );

        return { url, clientId, realm };
    })();

    return (() => {
        switch (regionS3.type) {
            case "minio":
                return {
                    "url": regionS3.url,
                    "region": regionS3.region ?? "us-east-1",
                    keycloakParams,
                    "amazon": undefined,
                };
            case "amazon":
                return {
                    "url": "https://s3.amazonaws.com",
                    "region": regionS3.region,
                    keycloakParams,
                    "amazon": {
                        "roleARN": regionS3.roleARN,
                        "roleSessionName": regionS3.roleSessionName,
                    },
                };
        }
    })();
}

export async function createS3Client(params: Params): Promise<S3Client> {
    const { url, region, keycloakParams } = params;

    const { host, port = 443 } = parseUrl(params.url);

    const oidcClient = await createKeycloakOidcClient(keycloakParams);

    if (!oidcClient.isUserLoggedIn) {
        return oidcClient.login();
    }

    const { getAccessToken } = oidcClient;

    const { getNewlyRequestedOrCachedToken } = getNewlyRequestedOrCachedTokenFactory({
        "requestNewToken": async (restrictToBucketName: string | undefined) => {
            const now = Date.now();

            const { data } = await axios.create({ "baseURL": url }).post<string>(
                "/?" +
                    Object.entries({
                        "Action": "AssumeRoleWithWebIdentity",
                        "WebIdentityToken": await getAccessToken(),
                        //Desired TTL of the token, depending of the configuration
                        //and version of minio we could get less than that but never more.
                        "DurationSeconds": 7 * 24 * 3600,
                        "Version": "2011-06-15",
                        ...(restrictToBucketName === undefined
                            ? {}
                            : {
                                  "Policy": JSON.stringify({
                                      "Version": "2012-10-17",
                                      "Statement": [
                                          {
                                              "Effect": "Allow",
                                              "Action": ["s3:*"],
                                              "Resource": [
                                                  `arn:aws:s3:::${restrictToBucketName}`,
                                                  `arn:aws:s3:::${restrictToBucketName}/*`,
                                              ],
                                          },
                                          {
                                              "Effect": "Allow",
                                              "Action": ["s3:ListBucket"],
                                              "Resource": ["arn:aws:s3:::*"],
                                              "Condition": {
                                                  "StringLike": {
                                                      "s3:prefix": "diffusion/*",
                                                  },
                                              },
                                          },
                                          {
                                              "Effect": "Allow",
                                              "Action": ["s3:GetObject"],
                                              "Resource": ["arn:aws:s3:::*/diffusion/*"],
                                          },
                                      ],
                                  }),
                              }),
                    })
                        .map(([key, value]) => `${key}=${value}`)
                        .join("&"),
            );

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data, "text/xml");
            const root = xmlDoc.getElementsByTagName(
                "AssumeRoleWithWebIdentityResponse",
            )[0];

            const credentials = root.getElementsByTagName("Credentials")[0];
            const accessKeyId =
                credentials.getElementsByTagName("AccessKeyId")[0].childNodes[0]
                    .nodeValue;
            const secretAccessKey =
                credentials.getElementsByTagName("SecretAccessKey")[0].childNodes[0]
                    .nodeValue;
            const sessionToken =
                credentials.getElementsByTagName("SessionToken")[0].childNodes[0]
                    .nodeValue;
            const expiration =
                credentials.getElementsByTagName("Expiration")[0].childNodes[0].nodeValue;

            assert(
                accessKeyId !== null &&
                    secretAccessKey !== null &&
                    sessionToken !== null &&
                    expiration !== null,
                "Error parsing minio response",
            );

            return id<ReturnType<S3Client["getToken"]>>({
                accessKeyId,
                "expirationTime": new Date(expiration).getTime(),
                secretAccessKey,
                sessionToken,
                "acquisitionTime": now,
            });
        },
        "returnCachedTokenIfStillValidForXPercentOfItsTTL": "90%",
    });

    const { getMinioClient } = (() => {
        const minioClientByTokenObj = new WeakMap<
            ReturnType<S3Client["getToken"]>,
            Minio.Client
        >();

        async function getMinioClient(params: {
            restrictToBucketName: string | undefined;
        }) {
            const { restrictToBucketName } = params;

            const tokenObj = await getNewlyRequestedOrCachedToken(restrictToBucketName);

            let minioClient = minioClientByTokenObj.get(tokenObj);

            if (minioClient === undefined) {
                minioClient = new Minio.Client({
                    "endPoint": host,
                    "port": port,
                    "useSSL": port !== 80,
                    "accessKey": tokenObj.accessKeyId,
                    "secretKey": tokenObj.secretAccessKey,
                    "sessionToken": tokenObj.sessionToken,
                });

                minioClientByTokenObj.set(tokenObj, minioClient);
            }

            return { minioClient };
        }

        return { getMinioClient };
    })();

    const s3Client: S3Client = {
        "getToken": async ({ restrictToBucketName }) =>
            getNewlyRequestedOrCachedToken(restrictToBucketName),
        "createBucketIfNotExist": memoize(
            async bucketName => {
                const { minioClient } = await getMinioClient({
                    "restrictToBucketName": bucketName,
                });

                const bucketNames = await new Promise<string[]>((resolve, reject) =>
                    minioClient.listBuckets((error, result) => {
                        if (error !== null) {
                            reject(error);
                            return;
                        }
                        resolve(result.map(({ name }) => name));
                    }),
                );

                if (bucketNames.indexOf(bucketName) >= 0) {
                    return;
                }

                await new Promise<void>((resolve, reject) =>
                    minioClient.makeBucket(bucketName, region, error =>
                        error !== null ? reject(error) : resolve(),
                    ),
                );
            },
            { "promise": true },
        ),
        "list": async ({ path }) => {
            const { bucketName, prefix } = (() => {
                const [bucketName, ...rest] = path.replace(/^\/+/, "").split("/");

                return {
                    bucketName,
                    "prefix": rest.join("/"),
                };
            })();

            await s3Client.createBucketIfNotExist(bucketName);

            const { minioClient } = await getMinioClient({
                "restrictToBucketName": bucketName,
            });

            const stream = minioClient.listObjects(bucketName, prefix, false);

            const out: ReturnType<S3Client["list"]> = {
                "directories": [],
                "files": [],
            };

            stream.once("end", () => dOut.resolve(out));
            stream.on("data", bucketItem => {
                if (bucketItem.prefix) {
                    out.directories.push(bucketItem.prefix.replace(/\/+$/, ""));
                } else {
                    out.files.push(bucketItem.name);
                }
            });

            const dOut = new Deferred<typeof out>();

            return dOut.pr;
        },
    };

    dS3Client.resolve(s3Client);

    return s3Client;
}

const dS3Client = new Deferred<S3Client>();

/** @deprecated */
export const { pr: prS3Client } = dS3Client;

export const s3ApiLogger: ApiLogger<S3Client> = {
    "initialHistory": [],
    "methods": {
        //TODO, this is dummy
        "list": {
            "buildCmd": ({ path }) => `mc list ${pathJoin(path)}`,
            "fmtResult": ({ result: { directories, files } }) =>
                [
                    "Keys",
                    "----",
                    ...[...directories.map(directory => `${directory}/`), ...files],
                ].join("\n"),
        },
        "getToken": {
            "buildCmd": ({ restrictToBucketName }) =>
                [
                    `# We generate a token restricted to the bucket ${restrictToBucketName}`,
                    `# See https://docs.min.io/docs/minio-sts-quickstart-guide.html`,
                ].join("\n"),
            "fmtResult": ({ result }) => `The token we got is ${JSON.stringify(result)}`,
        },
        "createBucketIfNotExist": {
            "buildCmd": bucketName =>
                `# We create the token ${bucketName} if it doesn't exist.`,
            "fmtResult": () => `# Done`,
        },
    },
};