use crate::state::PrinterSettings;
use ab_glyph::{FontRef, PxScale};
use image::{GrayImage, Luma};
use imageproc::drawing::draw_text_mut;
use std::path::Path;

const DOTS_PER_MM: u32 = 8;

struct FontSizes {
    row_1: PxScale,
    row_2: PxScale,
    row_3: PxScale,
    row_4: PxScale,
    row_5: PxScale,
    row_6: PxScale,
}

pub fn render_label(
    fecha_hora: &str,
    fecha_vencimiento: &str,
    peso_g: i32,
    precio_total: f64,
    font_data: &[u8],
    settings: &PrinterSettings,
) -> Vec<u8> {
    let font = FontRef::try_from_slice(font_data).expect("Failed to load font");

    let ancho_dots = settings.label_width_mm * DOTS_PER_MM;
    let alto_dots = settings.label_height_mm * DOTS_PER_MM;
    let ancho_bytes = ancho_dots / 8;
    let x_pos = settings.left_margin;
    let x_offset = settings.x_offset;
    let top_margin = settings.top_margin;

    let sizes = FontSizes {
        row_1: PxScale::from(settings.font_size_row_1),
        row_2: PxScale::from(settings.font_size_row_2),
        row_3: PxScale::from(settings.font_size_row_3),
        row_4: PxScale::from(settings.font_size_row_4),
        row_5: PxScale::from(settings.font_size_row_5),
        row_6: PxScale::from(settings.font_size_row_6),
    };

    let mut img = GrayImage::from_pixel(ancho_dots, alto_dots, Luma([255u8]));

    let linea_1 = settings.font_size_row_1 as i32 + 6;
    let linea_2 = settings.font_size_row_2 as i32 + 6;
    let linea_3 = settings.font_size_row_3 as i32 + 6;
    let linea_4 = settings.font_size_row_4 as i32 + 6;
    let linea_5 = settings.font_size_row_5 as i32 + 8;
    let _linea_6 = settings.font_size_row_6 as i32 + 8;

    let mut y_pos = top_margin;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_1,
        &font,
        "Fecha de empaque:",
    );
    y_pos += linea_1;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_2,
        &font,
        fecha_hora,
    );
    y_pos += linea_2;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_3,
        &font,
        "Vence:",
    );
    y_pos += linea_3;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_4,
        &font,
        fecha_vencimiento,
    );
    y_pos += linea_4;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_5,
        &font,
        &format!("Peso: {}g", peso_g),
    );
    y_pos += linea_5;

    let precio_str = format!("${:.0}", precio_total);
    draw_text_mut(
        &mut img,
        Luma([0u8]),
        x_pos,
        y_pos,
        sizes.row_6,
        &font,
        &precio_str,
    );

    let bitmap = image_to_1bit(&img, ancho_dots, alto_dots, ancho_bytes);

    let mut tspl = Vec::new();
    tspl.extend_from_slice(b"CLS\n");
    tspl.extend_from_slice(format!(
        "SIZE {} mm, {} mm\n",
        settings.label_width_mm, settings.label_height_mm
    ).as_bytes());
    tspl.extend_from_slice(b"GAP 0, 0\n");
    tspl.extend_from_slice(format!("DENSITY {}\n", settings.density).as_bytes());
    tspl.extend_from_slice(format!("SPEED {}\n", settings.speed).as_bytes());

    let header = format!(
        "BITMAP {}, 0, {}, {}, 0, ",
        x_offset, ancho_bytes, alto_dots
    );
    tspl.extend_from_slice(header.as_bytes());
    tspl.extend_from_slice(&bitmap);
    tspl.extend_from_slice(b"\n");
    tspl.extend_from_slice(b"PRINT 1\n");

    tspl
}

fn image_to_1bit(img: &GrayImage, ancho: u32, alto: u32, ancho_bytes: u32) -> Vec<u8> {
    let mut bitmap = Vec::with_capacity((ancho_bytes * alto) as usize);

    for y in 0..alto {
        let mut row_bytes = vec![0u8; ancho_bytes as usize];
        for x in 0..ancho {
            let pixel = img.get_pixel(x, y);
            let value = pixel[0];
            let bit = (value >= 128) as u8;
            if bit == 1 {
                let byte_idx = (x / 8) as usize;
                let bit_idx = 7 - (x % 8) as usize;
                row_bytes[byte_idx] |= 1 << bit_idx;
            }
        }
        bitmap.extend_from_slice(&row_bytes);
    }

    bitmap
}

pub fn load_font(resource_dir: &Path) -> Vec<u8> {
    let font_path = resource_dir.join("fonts").join("DejaVuSans-Bold.ttf");
    if font_path.exists() {
        std::fs::read(&font_path).unwrap_or_else(|_| {
            let sys_path = Path::new("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
            std::fs::read(sys_path).expect("Failed to load font")
        })
    } else {
        let sys_path = Path::new("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
        std::fs::read(sys_path).expect("Failed to load font")
    }
}
