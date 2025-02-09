import { useEffect, useReducer, memo } from "react";
import { useTranslation } from "ui/i18n";
import { AccountSectionHeader } from "../AccountSectionHeader";
import { AccountField } from "../AccountField";
import { useSelector, useThunks } from "ui/coreApi";
import { useCallbackFactory } from "powerhooks/useCallbackFactory";
import { copyToClipboard } from "ui/tools/copyToClipboard";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import { useConstCallback } from "powerhooks/useConstCallback";
import { makeStyles } from "ui/theme";
import { useAsync } from "react-async-hook";
import { declareComponentKeys } from "i18nifty";

export type Props = {
    className?: string;
};

export const AccountInfoTab = memo((props: Props) => {
    const { className } = props;

    const { t } = useTranslation({ AccountInfoTab });

    const { publicIpThunks, projectConfigsThunks, userAuthenticationThunks } =
        useThunks();

    const onRequestCopyFactory = useCallbackFactory(([textToCopy]: [string]) =>
        copyToClipboard(textToCopy),
    );

    const publicIp = useSelector(state => state.publicIp) ?? "Loading...";

    const selectedProjectId = useSelector(
        state => state.projectSelection.selectedProjectId,
    );

    useEffect(() => {
        publicIpThunks.fetch();
    }, []);

    const [refreshServicePasswordTrigger, pullRefreshServicePasswordTrigger] = useReducer(
        n => n + 1,
        0,
    );

    const servicePasswordAsync = useAsync(
        () => projectConfigsThunks.getValue({ "key": "servicePassword" }),
        [refreshServicePasswordTrigger, selectedProjectId],
    );

    const onRequestServicePasswordRenewal = useConstCallback(async () => {
        await projectConfigsThunks.renewServicePassword();

        pullRefreshServicePasswordTrigger();
    });

    const user = userAuthenticationThunks.getUser();

    const fullName = `${user.firstName} ${user.familyName}`;

    const keycloakAccountConfigurationUrl =
        userAuthenticationThunks.getKeycloakAccountConfigurationUrl();

    const { classes } = useStyles();

    return (
        <div className={className}>
            <AccountSectionHeader title={t("general information")} />
            <AccountField
                type="text"
                title={t("user id")}
                text={user.username}
                onRequestCopy={onRequestCopyFactory(user.username)}
            />
            <AccountField
                type="text"
                title={t("full name")}
                text={fullName}
                onRequestCopy={onRequestCopyFactory(fullName)}
            />
            <AccountField
                type="text"
                title={t("email")}
                text={user.email}
                onRequestCopy={onRequestCopyFactory(user.email)}
            />
            {keycloakAccountConfigurationUrl !== undefined && (
                <Link
                    className={classes.link}
                    href={keycloakAccountConfigurationUrl}
                    target="_blank"
                    underline="hover"
                >
                    {t("change account info")}
                </Link>
            )}
            <Divider className={classes.divider} variant="middle" />
            <AccountSectionHeader
                title={t("auth information")}
                helperText={t("auth information helper")}
            />
            <AccountField
                type="service password"
                isLocked={servicePasswordAsync.loading}
                servicePassword={servicePasswordAsync.result ?? "⏳"}
                onRequestCopy={
                    servicePasswordAsync.result === undefined
                        ? () => {}
                        : onRequestCopyFactory(servicePasswordAsync.result)
                }
                onRequestServicePasswordRenewal={onRequestServicePasswordRenewal}
            />
            <AccountField
                type="text"
                title={t("ip address")}
                text={publicIp}
                onRequestCopy={onRequestCopyFactory(publicIp)}
            />
        </div>
    );
});

export const { i18n } = declareComponentKeys<
    | "general information"
    | "user id"
    | "full name"
    | "email"
    | "change account info"
    | "auth information"
    | "auth information helper"
    | "ip address"
>()({ AccountInfoTab });

const useStyles = makeStyles({ "name": { AccountInfoTab } })(theme => ({
    "divider": {
        ...theme.spacing.topBottom("margin", 4),
    },
    "link": {
        "marginTop": theme.spacing(2),
        "display": "inline-block",
    },
}));
