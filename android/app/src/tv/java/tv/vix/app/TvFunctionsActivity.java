package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.GridLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class TvFunctionsActivity extends AppCompatActivity {
    private static final String[][] ITEMS = {
        {"Ajuste de reproducir", "▶"},
        {"Configuraciones", "🔒"},
        {"Limpiar caché", "🗑"},
        {"Centro de ayuda", "?"},
        {"Feedback", "✎"},
        {"Actualización", "↑"},
        {"Sobre nosotros", "i"},
        {"Mi cuenta", "👤"},
        {"Historia", "📺"}
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_functions);
        GridLayout grid = findViewById(R.id.tv_functions_grid);
        int col = 0;
        int row = 0;
        for (String[] item : ITEMS) {
            View tile = createTile(item[0], item[1]);
            GridLayout.Spec rowSpec = GridLayout.spec(row);
            GridLayout.Spec colSpec = GridLayout.spec(col, 1f);
            GridLayout.LayoutParams lp = new GridLayout.LayoutParams(rowSpec, colSpec);
            lp.width = 0;
            lp.height = dp(120);
            lp.setMargins(dp(6), dp(6), dp(6), dp(6));
            tile.setLayoutParams(lp);
            grid.addView(tile);
            col++;
            if (col >= 5) {
                col = 0;
                row++;
            }
        }
    }

    private View createTile(String label, String icon) {
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundResource(R.drawable.tv_poster_selector);
        box.setFocusable(true);
        box.setPadding(dp(12), dp(12), dp(12), dp(12));
        TextView ic = new TextView(this);
        ic.setText(icon);
        ic.setTextColor(getColor(R.color.tv_text));
        ic.setTextSize(28);
        ic.setGravity(Gravity.CENTER);
        TextView tx = new TextView(this);
        tx.setText(label);
        tx.setTextColor(getColor(R.color.tv_text));
        tx.setTextSize(12);
        tx.setGravity(Gravity.CENTER);
        box.addView(ic);
        box.addView(tx);
        box.setOnClickListener(v -> onTile(label));
        return box;
    }

    private void onTile(String label) {
        switch (label) {
            case "Actualización":
                UpdateChecker.checkAsync(this);
                Toast.makeText(this, "Buscando actualización…", Toast.LENGTH_SHORT).show();
                break;
            case "Limpiar caché":
                Toast.makeText(this, "Caché limpiada", Toast.LENGTH_SHORT).show();
                break;
            case "Mi cuenta":
                startActivity(new Intent(this, TvAccountActivity.class));
                break;
            case "Historia":
                startActivity(new Intent(this, TvHistoryActivity.class));
                break;
            case "Sobre nosotros":
                Toast.makeText(this, "Vix TV", Toast.LENGTH_SHORT).show();
                break;
            default:
                Toast.makeText(this, label, Toast.LENGTH_SHORT).show();
        }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
