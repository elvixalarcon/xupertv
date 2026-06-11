package tv.vix.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class UpdateChecker {
    public static final String ACTION_UPDATE = "tv.vix.app.ACTION_UPDATE";
    public static final String EXTRA_DOWNLOAD_URL = "download_url";
    public static final String EXTRA_VERSION_NAME = "version_name";
    private static final String CHANNEL_ID = "vixtv_updates";
    private static final int NOTIFICATION_ID = 9001;

    private UpdateChecker() {}

    public static void checkAsync(Context context) {
        new Thread(() -> check(context)).start();
    }

    public static void startDownload(AppCompatActivity activity, String downloadUrl) {
        startDownload(activity, downloadUrl, null);
    }

    public static void startDownload(AppCompatActivity activity, String downloadUrl, String versionName) {
        if (activity == null || activity.isFinishing()) return;
        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            Toast.makeText(activity, R.string.update_download_failed, Toast.LENGTH_SHORT).show();
            return;
        }

        int serverVersionCode = parseVersionCodeFromUrl(downloadUrl);
        if (serverVersionCode > 0 && serverVersionCode <= BuildConfig.VERSION_CODE) {
            Toast.makeText(activity, R.string.update_already_latest, Toast.LENGTH_LONG).show();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity)
                .setTitle(R.string.update_permission_title)
                .setMessage(R.string.update_permission_message)
                .setPositiveButton(R.string.update_permission_open, (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    intent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                })
                .setNegativeButton(android.R.string.cancel, null)
                .show();
            return;
        }

        showDownloadDialog(activity, downloadUrl.trim(), versionName);
    }

    public static void handleUpdateIntent(Context context, Intent intent) {
        if (intent == null || !ACTION_UPDATE.equals(intent.getAction())) return;
        String url = intent.getStringExtra(EXTRA_DOWNLOAD_URL);
        if (url == null || url.trim().isEmpty()) return;
        String versionName = intent.getStringExtra(EXTRA_VERSION_NAME);
        if (context instanceof AppCompatActivity) {
            startDownload((AppCompatActivity) context, url.trim(), versionName);
        }
        intent.removeExtra(EXTRA_DOWNLOAD_URL);
        intent.removeExtra(EXTRA_VERSION_NAME);
        intent.setAction(null);
    }

    private static void showDownloadDialog(AppCompatActivity activity, String downloadUrl, String versionName) {
        View content = LayoutInflater.from(activity).inflate(R.layout.dialog_update_download, null);
        TextView titleView = content.findViewById(R.id.update_title);
        TextView statusView = content.findViewById(R.id.update_status);
        TextView percentView = content.findViewById(R.id.update_percent);
        ProgressBar progressBar = content.findViewById(R.id.update_progress);

        if (versionName != null && !versionName.isEmpty()) {
            titleView.setText(activity.getString(R.string.update_notification_title_version, versionName));
        }
        statusView.setText(activity.getString(R.string.update_download_starting));

        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setView(content)
            .setCancelable(false)
            .create();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawableResource(android.R.color.transparent);
            if ("tv".equals(BuildConfig.PLATFORM)) {
                centerDialogWindow(window, (int) (activity.getResources().getDisplayMetrics().density * 440));
            }
        }
        dialog.show();

        new Thread(() -> downloadApk(activity, downloadUrl, progressBar, statusView, percentView, dialog)).start();
    }

    private static void downloadApk(
        AppCompatActivity activity,
        String downloadUrl,
        ProgressBar progressBar,
        TextView statusView,
        TextView percentView,
        AlertDialog dialog
    ) {
        HttpURLConnection conn = null;
        File outFile = null;
        try {
            File dir = new File(activity.getExternalFilesDir(null), "updates");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IllegalStateException("No update dir");
            }

            int serverVersionCode = parseVersionCodeFromUrl(downloadUrl);
            String fileName = BuildConfig.PLATFORM.equals("tv")
                ? "VixTV-tv-" + (serverVersionCode > 0 ? serverVersionCode : BuildConfig.VERSION_CODE + 1) + ".apk"
                : "VixTV-mobile-" + (serverVersionCode > 0 ? serverVersionCode : BuildConfig.VERSION_CODE + 1) + ".apk";
            outFile = new File(dir, fileName);
            if (outFile.exists() && !outFile.delete()) {
                throw new IllegalStateException("Cannot replace old apk");
            }

            URL url = new URL(downloadUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
            conn.setRequestProperty("User-Agent", "VixTV/" + BuildConfig.VERSION_NAME + " " + BuildConfig.PLATFORM);

            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("HTTP " + code);
            }

            int totalBytes = conn.getContentLength();
            activity.runOnUiThread(() -> {
                progressBar.setIndeterminate(totalBytes <= 0);
                if (totalBytes > 0) {
                    progressBar.setMax(100);
                    progressBar.setProgress(0);
                }
                statusView.setText(activity.getString(R.string.update_downloading));
            });

            try (InputStream raw = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(outFile)) {
                byte[] buffer = new byte[16384];
                long downloaded = 0;
                int read;
                while ((read = raw.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    downloaded += read;
                    if (totalBytes > 0) {
                        final int pct = (int) Math.min(100, (downloaded * 100L) / totalBytes);
                        activity.runOnUiThread(() -> {
                            progressBar.setIndeterminate(false);
                            progressBar.setProgress(pct);
                            percentView.setText(pct + "%");
                        });
                    }
                }
                out.getFD().sync();
            }

            if (!outFile.exists() || outFile.length() < 1024) {
                throw new IllegalStateException("Empty apk");
            }

            File finalFile = outFile;
            activity.runOnUiThread(() -> {
                dialog.dismiss();
                promptInstall(activity, finalFile);
            });
        } catch (Exception ex) {
            if (outFile != null && outFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                outFile.delete();
            }
            activity.runOnUiThread(() -> {
                dialog.dismiss();
                Toast.makeText(activity, R.string.update_download_failed, Toast.LENGTH_LONG).show();
            });
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void promptInstall(AppCompatActivity activity, File apkFile) {
        if ("tv".equals(BuildConfig.PLATFORM)) {
            showTvInstallDialog(activity, apkFile);
            return;
        }
        new AlertDialog.Builder(activity)
            .setTitle(R.string.update_install_title_generic)
            .setMessage(R.string.update_install_message)
            .setPositiveButton(R.string.update_install_action, (dialog, which) -> launchInstall(activity, apkFile))
            .setNegativeButton(android.R.string.cancel, null)
            .show();
    }

    private static void launchInstall(AppCompatActivity activity, File apkFile) {
        try {
            Uri uri = FileProvider.getUriForFile(
                activity,
                activity.getPackageName() + ".fileprovider",
                apkFile
            );
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(install);
        } catch (Exception ex) {
            new AlertDialog.Builder(activity)
                .setTitle(R.string.update_download_failed)
                .setMessage(R.string.update_signature_hint)
                .setPositiveButton(android.R.string.ok, null)
                .show();
        }
    }

    private static int parseVersionCodeFromUrl(String downloadUrl) {
        try {
            Uri uri = Uri.parse(downloadUrl);
            String v = uri.getQueryParameter("v");
            if (v != null && !v.isEmpty()) {
                return Integer.parseInt(v);
            }
        } catch (Exception ignored) {
            // ignore malformed ?v=
        }
        return 0;
    }

    private static void check(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(AppConstants.PREFS, Context.MODE_PRIVATE);
            String server = ServerUrlHelper.fromPrefs(prefs);

            String checkUrl = server + "/api/app/update?platform=" + BuildConfig.PLATFORM
                + "&version_code=" + BuildConfig.VERSION_CODE;

            HttpURLConnection conn = (HttpURLConnection) new URL(checkUrl).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "VixTV/" + BuildConfig.VERSION_NAME + " " + BuildConfig.PLATFORM);

            if (conn.getResponseCode() != 200) return;

            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }

            JSONObject json = new JSONObject(body.toString());
            if (!json.optBoolean("update_available", false)) return;

            String message = json.optString("message", context.getString(R.string.update_default_message));
            String versionName = json.optString("version_name", "");
            String downloadUrl = json.optString("download_url", null);
            if (downloadUrl == null || downloadUrl.isEmpty()) return;

            if (context instanceof AppCompatActivity) {
                AppCompatActivity activity = (AppCompatActivity) context;
                if ("tv".equals(BuildConfig.PLATFORM)) {
                    showTvUpdateDialog(activity, message, versionName, downloadUrl);
                } else {
                    showUpdateDialog(activity, message, versionName, downloadUrl);
                }
            } else {
                showUpdateNotification(context, message, versionName, downloadUrl);
            }
        } catch (Exception ignored) {
            // Silent fail — app still works without update check
        }
    }

    private static void showUpdateDialog(AppCompatActivity activity, String message, String versionName, String downloadUrl) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing()) return;
            String title = versionName.isEmpty()
                ? activity.getString(R.string.update_notification_title)
                : activity.getString(R.string.update_notification_title_version, versionName);
            new AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(R.string.update_action_download, (dialog, which) ->
                    startDownload(activity, downloadUrl, versionName))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
        });
    }

    private static void showTvUpdateDialog(AppCompatActivity activity, String message, String versionName, String downloadUrl) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing()) return;
            View content = LayoutInflater.from(activity).inflate(R.layout.dialog_tv_update, null);
            TextView titleView = content.findViewById(R.id.tv_update_title);
            TextView messageView = content.findViewById(R.id.tv_update_message);
            Button downloadBtn = content.findViewById(R.id.tv_update_download);
            Button laterBtn = content.findViewById(R.id.tv_update_later);

            titleView.setText(versionName.isEmpty()
                ? activity.getString(R.string.update_notification_title)
                : activity.getString(R.string.update_notification_title_version, versionName));
            messageView.setText(message != null && !message.isEmpty()
                ? message
                : activity.getString(R.string.update_default_message));

            AlertDialog dialog = new AlertDialog.Builder(activity)
                .setView(content)
                .setCancelable(true)
                .create();
            Window window = dialog.getWindow();
            if (window != null) {
                window.setBackgroundDrawableResource(android.R.color.transparent);
                centerDialogWindow(window, (int) (activity.getResources().getDisplayMetrics().density * 460));
            }
            downloadBtn.setOnClickListener(v -> {
                dialog.dismiss();
                startDownload(activity, downloadUrl, versionName);
            });
            laterBtn.setOnClickListener(v -> dialog.dismiss());
            dialog.show();
            downloadBtn.requestFocus();
        });
    }

    private static void showTvInstallDialog(AppCompatActivity activity, File apkFile) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing()) return;
            View content = LayoutInflater.from(activity).inflate(R.layout.dialog_tv_update, null);
            TextView titleView = content.findViewById(R.id.tv_update_title);
            TextView messageView = content.findViewById(R.id.tv_update_message);
            Button installBtn = content.findViewById(R.id.tv_update_download);
            Button laterBtn = content.findViewById(R.id.tv_update_later);

            titleView.setText(activity.getString(R.string.update_install_title_generic));
            messageView.setText(activity.getString(R.string.update_install_message));
            installBtn.setText(activity.getString(R.string.update_install_action));
            laterBtn.setText(activity.getString(R.string.update_later));

            AlertDialog dialog = new AlertDialog.Builder(activity)
                .setView(content)
                .setCancelable(true)
                .create();
            Window window = dialog.getWindow();
            if (window != null) {
                window.setBackgroundDrawableResource(android.R.color.transparent);
                centerDialogWindow(window, (int) (activity.getResources().getDisplayMetrics().density * 460));
            }
            installBtn.setOnClickListener(v -> {
                dialog.dismiss();
                launchInstall(activity, apkFile);
            });
            laterBtn.setOnClickListener(v -> dialog.dismiss());
            dialog.show();
            installBtn.requestFocus();
        });
    }

    private static void centerDialogWindow(Window window, int widthPx) {
        window.setGravity(Gravity.CENTER);
        window.setLayout(widthPx, WindowManager.LayoutParams.WRAP_CONTENT);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        WindowManager.LayoutParams lp = window.getAttributes();
        lp.dimAmount = 0.72f;
        window.setAttributes(lp);
    }

    private static void showUpdateNotification(Context context, String message, String versionName, String downloadUrl) {
        createChannel(context);

        String launchClass = "tv".equals(BuildConfig.PLATFORM)
            ? "tv.vix.app.TvShellActivity"
            : "tv.vix.app.MainActivity";
        Intent openIntent = new Intent();
        openIntent.setClassName(context.getPackageName(), launchClass);
        openIntent.setAction(ACTION_UPDATE);
        openIntent.putExtra(EXTRA_DOWNLOAD_URL, downloadUrl);
        openIntent.putExtra(EXTRA_VERSION_NAME, versionName);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = versionName.isEmpty()
            ? context.getString(R.string.update_notification_title)
            : context.getString(R.string.update_notification_title_version, versionName);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_vix)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .addAction(
                new NotificationCompat.Action.Builder(
                    0,
                    context.getString(R.string.update_action_download),
                    pendingIntent
                ).build()
            );

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.update_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.update_channel_desc));
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }
}
